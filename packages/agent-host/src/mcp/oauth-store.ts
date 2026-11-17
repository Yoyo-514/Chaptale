import type { McpOAuthConfig } from '@earendil-works/pi-mcp';
import {
  completeMcpSignIn,
  listenForLoopbackSignIn,
  McpSignInCancelledError,
  type McpOAuthClientOptions,
  type McpOAuthServerStore,
  type McpOAuthSettings,
  type McpOAuthState,
  type McpSignInRedirect,
  type OAuthChallenge,
  startMcpSignIn,
  waitForLoopbackSignIn
} from '@earendil-works/pi-mcp/oauth';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CLIENT_NAME = 'Chaptale';

interface PersistedMcpAuthFile {
  version: 1;
  entries: Record<string, McpOAuthState>;
}

interface PendingSignInSession {
  nodeKey: string;
  serverUrl: string;
  authorizationUrl: string;
  abort: AbortController;
  resolveManualRedirect?: (url: string | undefined) => void;
  completion: Promise<Error | undefined>;
}

export function mcpAuthFile(agentDir: string): string {
  return join(agentDir, 'mcp-auth.json');
}

export function toOAuthSettings(raw: McpOAuthConfig | undefined): McpOAuthSettings {
  if (!raw) return {};
  return {
    ...(raw.clientId ? { clientId: raw.clientId } : {}),
    ...(raw.clientSecret ? { clientSecret: raw.clientSecret } : {}),
    ...(raw.callbackPort !== undefined ? { callbackPort: raw.callbackPort } : {}),
    ...(raw.callbackUrl ? { callbackUrl: raw.callbackUrl } : {}),
    ...(raw.scope ? { scope: raw.scope } : {}),
    ...(raw.clientName ? { clientName: raw.clientName } : {}),
    ...(raw.clientRegistration ? { clientRegistration: raw.clientRegistration } : {}),
    ...(raw.authServerMetadataUrl ? { authServerMetadataUrl: new URL(raw.authServerMetadataUrl) } : {})
  };
}

export class HostMcpOAuthCoordinator {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly refreshLocks = new Map<string, Promise<unknown>>();
  private readonly pendingSignIns = new Map<string, PendingSignInSession>();
  private readonly onStateChange?: () => void;

  constructor(options: { agentDir: string; onStateChange?: () => void }) {
    this.filePath = mcpAuthFile(options.agentDir);
    this.onStateChange = options.onStateChange;
  }

  private async readAll(): Promise<PersistedMcpAuthFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedMcpAuthFile>;
      if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
        return { version: 1, entries: { ...parsed.entries } };
      }
      return { version: 1, entries: {} };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, entries: {} };
      }
      throw cause;
    }
  }

  private enqueueWrite(mutator: (data: PersistedMcpAuthFile) => void): Promise<void> {
    const run = this.writeQueue.then(async () => {
      const current = await this.readAll();
      mutator(current);
      await mkdir(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(tempPath, this.filePath);
    });
    this.writeQueue = run.catch(() => {});
    return run;
  }

  serverStore(nodeKey: string, serverUrl: string): McpOAuthServerStore {
    return {
      load: async () => {
        await this.writeQueue;
        const data = await this.readAll();
        const entry = data.entries[nodeKey];
        if (!entry || entry.serverUrl !== serverUrl) return undefined;
        return entry;
      },
      save: async (state: McpOAuthState) => {
        await this.enqueueWrite(data => {
          data.entries[nodeKey] = state;
        });
      },
      withRefreshLock: async <T>(fn: () => Promise<T>): Promise<T> => {
        const previous = this.refreshLocks.get(nodeKey) ?? Promise.resolve();
        const next = previous.catch(() => {}).then(fn);
        const settled = next
          .finally(() => {
            if (this.refreshLocks.get(nodeKey) === settled) {
              this.refreshLocks.delete(nodeKey);
            }
          })
          .catch(() => {});
        this.refreshLocks.set(nodeKey, settled);
        return next;
      }
    };
  }

  async hasStoredTokens(nodeKey: string, serverUrl: string): Promise<boolean> {
    await this.writeQueue;
    const data = await this.readAll();
    const entry = data.entries[nodeKey];
    return Boolean(entry && entry.serverUrl === serverUrl && entry.tokens?.access_token);
  }

  async removeCredentials(nodeKey: string): Promise<void> {
    this.cancelSignIn(nodeKey);
    await this.enqueueWrite(data => {
      delete data.entries[nodeKey];
    });
  }

  async removeWorkCredentials(workId: string): Promise<void> {
    const prefix = `work:${workId}:`;
    for (const key of this.pendingSignIns.keys()) {
      if (key.startsWith(prefix)) this.cancelSignIn(key);
    }
    await this.enqueueWrite(data => {
      for (const key of Object.keys(data.entries)) {
        if (key.startsWith(prefix)) delete data.entries[key];
      }
    });
  }

  getPendingSignIn(nodeKey: string): { authorizationUrl: string } | undefined {
    const pending = this.pendingSignIns.get(nodeKey);
    return pending ? { authorizationUrl: pending.authorizationUrl } : undefined;
  }

  cancelSignIn(nodeKey: string): void {
    const pending = this.pendingSignIns.get(nodeKey);
    if (!pending) return;
    this.pendingSignIns.delete(nodeKey);
    pending.abort.abort();
    this.onStateChange?.();
  }

  async startSignIn(options: {
    nodeKey: string;
    serverUrl: string;
    oauthConfig: McpOAuthConfig | undefined;
    challenge?: OAuthChallenge;
    onAuthorized: () => Promise<void>;
    onFailed: (message: string) => void;
  }): Promise<{ authorized: boolean; authorizationUrl?: string }> {
    this.cancelSignIn(options.nodeKey);

    const store = this.serverStore(options.nodeKey, options.serverUrl);
    const settings = toOAuthSettings(options.oauthConfig);
    const abort = new AbortController();

    const loopback = await listenForLoopbackSignIn({
      serverUrl: options.serverUrl,
      store,
      settings
    });

    const clientOptions: McpOAuthClientOptions = {
      serverUrl: options.serverUrl,
      store,
      settings,
      clientName: CLIENT_NAME
    };

    let started: { kind: 'authorized' } | McpSignInRedirect;
    try {
      started = await startMcpSignIn({
        ...clientOptions,
        redirectUrl: loopback.redirectUrl,
        challenge: options.challenge,
        signal: abort.signal
      });
    } catch (cause) {
      await loopback.callback.close();
      throw cause;
    }

    if (started.kind === 'authorized') {
      await loopback.callback.close();
      await options.onAuthorized();
      return { authorized: true };
    }

    let resolveManual: ((url: string | undefined) => void) | undefined;
    const manualRedirectPromise = new Promise<string | undefined>(resolve => {
      resolveManual = resolve;
    });

    const session: PendingSignInSession = {
      nodeKey: options.nodeKey,
      serverUrl: options.serverUrl,
      authorizationUrl: started.authorizationUrl,
      abort,
      resolveManualRedirect: resolveManual,
      completion: Promise.resolve(undefined)
    };

    session.completion = (async (): Promise<Error | undefined> => {
      try {
        const response = await waitForLoopbackSignIn({
          callback: loopback.callback,
          authorization: started,
          promptForRedirectUrl: signal =>
            new Promise<string | undefined>(resolve => {
              if (signal.aborted) {
                resolve(undefined);
                return;
              }
              signal.addEventListener('abort', () => resolve(undefined), { once: true });
              void manualRedirectPromise.then(resolve);
            }),
          signal: abort.signal
        });
        await completeMcpSignIn({
          ...clientOptions,
          redirectUrl: loopback.redirectUrl,
          authorization: started,
          response,
          signal: abort.signal
        });
        if (this.pendingSignIns.get(options.nodeKey) === session) {
          this.pendingSignIns.delete(options.nodeKey);
        }
        await options.onAuthorized();
        return undefined;
      } catch (cause) {
        if (this.pendingSignIns.get(options.nodeKey) === session) {
          this.pendingSignIns.delete(options.nodeKey);
        }
        const err = cause instanceof Error ? cause : new Error(String(cause));
        if (!(cause instanceof McpSignInCancelledError) && !abort.signal.aborted) {
          options.onFailed(err.message);
        }
        return err;
      } finally {
        await loopback.callback.close().catch(() => {});
        this.onStateChange?.();
      }
    })();

    this.pendingSignIns.set(options.nodeKey, session);
    this.onStateChange?.();
    return { authorized: false, authorizationUrl: started.authorizationUrl };
  }

  async submitRedirectUrl(nodeKey: string, redirectUrl: string): Promise<void> {
    const pending = this.pendingSignIns.get(nodeKey);
    if (!pending) {
      throw new Error('当前服务没有正在等待回调的 OAuth 登录，请先点击“登录”。');
    }
    const trimmed = redirectUrl.trim();
    if (!trimmed) {
      throw new Error('请粘贴浏览器跳转后的完整地址。');
    }
    pending.resolveManualRedirect?.(trimmed);
    const err = await pending.completion;
    if (err) throw err;
  }

  close(): void {
    for (const key of this.pendingSignIns.keys()) {
      this.cancelSignIn(key);
    }
  }
}
