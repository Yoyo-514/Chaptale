import type { McpServerConfig } from '@earendil-works/pi-coding-agent';
import {
  type InitializeResult,
  isJsonRpcNotification,
  isJsonRpcRequest,
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  type JsonRpcMessage,
  McpAuthRequiredError,
  McpClient,
  McpConnectionClosedError,
  McpError,
  type McpTransport,
  type McpTransportCloseListener,
  type McpTransportErrorListener,
  type McpTransportMessageListener,
  type McpTransportSendOptions,
  StdioTransport,
  StreamableHttpTransport,
  type Tool
} from '@earendil-works/pi-mcp';
import {
  createMcpAuthProvider,
  McpOAuthAuthorizationRequiredError,
  type OAuthChallenge
} from '@earendil-works/pi-mcp/oauth';
import { resolve } from 'node:path';

import type { McpServerState, McpToolSummary } from '../protocol.ts';
import type { ResolvedMcpServerEntry } from './config.ts';
import { type HostMcpOAuthCoordinator, toOAuthSettings } from './oauth-store.ts';

const CLIENT_INFO = { name: 'Chaptale', version: '0.1.0' } as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** 远程服务未在 headers 中写死 Authorization 时走 OAuth 登录。 */
export function usesOAuth(config: McpServerConfig): boolean {
  return 'url' in config && !Object.keys(config.headers ?? {}).some(key => key.toLowerCase() === 'authorization');
}

function isAuthError(error: unknown): boolean {
  return error instanceof McpAuthRequiredError || error instanceof McpOAuthAuthorizationRequiredError;
}

/**
 * 面向单个 AgentSession 的轻量虚拟传输层：
 * 将多个会话的 JSON-RPC 请求复用到宿主进程内唯一的 SharedMcpNode.client，避免重复启动子进程。
 */
class VirtualSessionMcpTransport implements McpTransport {
  private readonly messageListeners = new Set<McpTransportMessageListener>();
  private readonly errorListeners = new Set<McpTransportErrorListener>();
  private readonly closeListeners = new Set<McpTransportCloseListener>();
  private readonly inFlight = new Map<JsonRpcId, AbortController>();
  private initResult: InitializeResult | undefined;
  private closed = false;
  private detachNode?: () => void;
  private readonly node: SharedMcpNode;

  constructor(node: SharedMcpNode) {
    this.node = node;
  }

  onMessage(listener: McpTransportMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: McpTransportErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: McpTransportCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.closed) throw new McpConnectionClosedError();
    this.initResult = await this.node.ensureConnected();
    if (this.closed) throw new McpConnectionClosedError();
    this.detachNode = this.node.attachVirtual({
      forwardNotification: msg => {
        if (!this.closed) this.emitMessage(msg);
      },
      forceClose: () => {
        void this.close();
      }
    });
  }

  async send(message: JsonRpcMessage, options?: McpTransportSendOptions): Promise<void> {
    if (this.closed) throw new McpConnectionClosedError();
    if (options?.signal?.aborted) return;

    if (isJsonRpcNotification(message)) {
      if (message.method === 'notifications/initialized') return;
      if (message.method === 'notifications/cancelled') {
        const reqId = (message.params as { requestId?: JsonRpcId } | undefined)?.requestId;
        if (reqId !== undefined) {
          this.inFlight.get(reqId)?.abort();
        }
        return;
      }
      await this.node.forwardNotify(message.method, message.params as Record<string, unknown> | undefined);
      return;
    }

    if (!isJsonRpcRequest(message)) return;

    if (message.method === 'initialize') {
      const result = this.initResult ?? (await this.node.ensureConnected());
      queueMicrotask(() => {
        if (!this.closed) {
          this.emitMessage({ jsonrpc: '2.0', id: message.id, result });
        }
      });
      return;
    }

    const controller = new AbortController();
    this.inFlight.set(message.id, controller);
    const onSendAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onSendAbort, { once: true });

    const rawParams = message.params as (Record<string, unknown> & { _meta?: { progressToken?: unknown } }) | undefined;
    const progressToken = rawParams?._meta?.progressToken;

    void (async () => {
      try {
        const result = await this.node.forwardRequest(message.method, rawParams, {
          signal: controller.signal,
          onProgress:
            progressToken !== undefined
              ? progress => {
                  if (!this.closed) {
                    this.emitMessage({
                      jsonrpc: '2.0',
                      method: 'notifications/progress',
                      params: { ...progress, progressToken }
                    });
                  }
                }
              : undefined
        });
        if (!this.closed && !controller.signal.aborted) {
          this.emitMessage({ jsonrpc: '2.0', id: message.id, result });
        }
      } catch (cause) {
        if (this.closed || controller.signal.aborted) return;
        if (cause instanceof McpError) {
          this.emitMessage({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: cause.code,
              message: cause.message,
              ...(cause.data !== undefined ? { data: cause.data } : {})
            }
          });
          return;
        }
        if (cause instanceof McpConnectionClosedError) {
          void this.close();
          return;
        }
        this.emitMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: JSON_RPC_ERROR_CODES.internalError,
            message: cause instanceof Error ? cause.message : String(cause)
          }
        });
      } finally {
        options?.signal?.removeEventListener('abort', onSendAbort);
        this.inFlight.delete(message.id);
      }
    })();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detachNode?.();
    this.detachNode = undefined;
    for (const ctrl of this.inFlight.values()) ctrl.abort();
    this.inFlight.clear();
    for (const listener of this.closeListeners) listener();
  }

  private emitMessage(msg: JsonRpcMessage): void {
    for (const listener of this.messageListeners) listener(msg);
  }
}

interface AttachedVirtualHandle {
  forwardNotification(msg: JsonRpcMessage): void;
  forceClose(): void;
}

export class SharedMcpNode {
  readonly nodeKey: string;
  readonly name: string;
  /** 节点的连接参数在生命周期内不变；参数变化时由服务层换新节点。 */
  readonly connectionKey: string;
  readonly config: McpServerConfig;
  readonly defaultCwd: string;
  private readonly oauth: HostMcpOAuthCoordinator;
  private readonly onChange: () => void;

  private stateValue: Exclude<McpServerState, 'disabled'> = 'connecting';
  private errorValue: string | undefined;
  private toolsValue: McpToolSummary[] = [];
  private hasResourcesValue = false;
  private lastChallengeValue: OAuthChallenge | undefined;

  private client: McpClient | undefined;
  private initResult: InitializeResult | undefined;
  private connectPromise: Promise<InitializeResult> | undefined;
  private generation = 0;
  private disposed = false;
  private readonly virtuals = new Set<AttachedVirtualHandle>();

  constructor(options: {
    entry: ResolvedMcpServerEntry;
    fallbackCwd: string;
    oauth: HostMcpOAuthCoordinator;
    onChange: () => void;
  }) {
    this.nodeKey = options.entry.nodeKey;
    this.name = options.entry.name;
    this.connectionKey = options.entry.connectionKey;
    this.config = options.entry.config;
    this.defaultCwd = options.entry.defaultCwd ?? options.fallbackCwd;
    this.oauth = options.oauth;
    this.onChange = options.onChange;
  }

  get state(): Exclude<McpServerState, 'disabled'> {
    return this.stateValue;
  }

  get error(): string | undefined {
    return this.errorValue;
  }

  get tools(): McpToolSummary[] {
    return this.toolsValue;
  }

  get hasResources(): boolean {
    return this.hasResourcesValue;
  }

  get lastChallenge(): OAuthChallenge | undefined {
    return this.lastChallengeValue;
  }

  setLastError(message: string): void {
    this.errorValue = message;
    this.onChange();
  }

  createVirtualTransport(): McpTransport {
    return new VirtualSessionMcpTransport(this);
  }

  attachVirtual(handle: AttachedVirtualHandle): () => void {
    this.virtuals.add(handle);
    return () => this.virtuals.delete(handle);
  }

  async forwardRequest(
    method: string,
    params: Record<string, unknown> | undefined,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: { progress: number; total?: number; message?: string }) => void;
    }
  ): Promise<unknown> {
    if (!this.client || this.client.connectionState !== 'connected') {
      await this.ensureConnected();
    }
    if (!this.client) throw new McpConnectionClosedError();
    return this.client.request(method, params, {
      signal: options.signal,
      timeoutMs: this.requestTimeoutMs(),
      onProgress: options.onProgress
    });
  }

  async forwardNotify(method: string, params: Record<string, unknown> | undefined): Promise<void> {
    if (!this.client || this.client.connectionState !== 'connected') return;
    await this.client.notify(method, params);
  }

  private requestTimeoutMs(): number {
    return this.config.timeout ? Math.round(this.config.timeout * 1000) : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  ensureConnected(): Promise<InitializeResult> {
    if (this.disposed) return Promise.reject(new McpConnectionClosedError());
    if (this.client && this.client.connectionState === 'connected' && this.initResult) {
      return Promise.resolve(this.initResult);
    }
    if (this.connectPromise) return this.connectPromise;

    const gen = ++this.generation;
    this.stateValue = 'connecting';
    this.errorValue = undefined;
    this.onChange();

    const run = this.connectInternal(gen);
    const tracked = run.finally(() => {
      if (this.connectPromise === tracked) {
        this.connectPromise = undefined;
      }
    });
    tracked.catch(() => {});
    this.connectPromise = tracked;
    return tracked;
  }

  private buildUpstreamTransport(): McpTransport {
    if ('command' in this.config) {
      const { command, args, cwd, env } = this.config;
      return new StdioTransport({
        command,
        args,
        cwd: cwd ? resolve(this.defaultCwd, cwd) : this.defaultCwd,
        env: env ? { ...env } : undefined
      });
    }

    const authProvider = usesOAuth(this.config)
      ? createMcpAuthProvider({
          serverUrl: this.config.url,
          store: this.oauth.serverStore(this.nodeKey, this.config.url),
          settings: () => toOAuthSettings('url' in this.config ? this.config.oauth : undefined),
          clientName: CLIENT_INFO.name,
          onChallenge: challenge => {
            this.lastChallengeValue = challenge;
          }
        })
      : undefined;

    return new StreamableHttpTransport({
      url: this.config.url,
      headers: this.config.headers ? { ...this.config.headers } : undefined,
      authProvider
    });
  }

  private async connectInternal(gen: number): Promise<InitializeResult> {
    const client = new McpClient({
      ...CLIENT_INFO,
      requestTimeoutMs: this.requestTimeoutMs()
    });
    const transport = this.buildUpstreamTransport();

    try {
      const init = await client.connect(transport);
      if (this.disposed || gen !== this.generation) {
        await client.close().catch(() => {});
        throw new McpConnectionClosedError();
      }

      const hasToolsCap = Boolean(init.capabilities.tools);
      const hasResourcesCap = Boolean(init.capabilities.resources);
      const listedTools: Tool[] = hasToolsCap ? await client.listTools() : [];

      if (this.disposed || gen !== this.generation) {
        await client.close().catch(() => {});
        throw new McpConnectionClosedError();
      }

      this.client = client;
      this.initResult = init;
      this.hasResourcesValue = hasResourcesCap;
      this.toolsValue = listedTools.map(tool => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {})
      }));
      this.stateValue = 'connected';
      this.errorValue = undefined;

      client.onNotification('notifications/tools/list_changed', params => {
        if (this.client !== client) return;
        for (const v of this.virtuals) {
          v.forwardNotification({
            jsonrpc: '2.0',
            method: 'notifications/tools/list_changed',
            ...(params !== undefined ? { params: params as Record<string, unknown> } : {})
          });
        }
        void client
          .listTools()
          .then(updated => {
            if (this.client !== client) return;
            this.toolsValue = updated.map(tool => ({
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {})
            }));
            this.onChange();
          })
          .catch(() => {});
      });

      client.onNotification('notifications/resources/list_changed', params => {
        if (this.client !== client) return;
        for (const v of this.virtuals) {
          v.forwardNotification({
            jsonrpc: '2.0',
            method: 'notifications/resources/list_changed',
            ...(params !== undefined ? { params: params as Record<string, unknown> } : {})
          });
        }
      });

      client.onClose(() => {
        if (this.client !== client) return;
        this.client = undefined;
        this.initResult = undefined;
        this.toolsValue = [];
        this.hasResourcesValue = false;
        if (!this.disposed && gen === this.generation) {
          this.stateValue = 'failed';
          this.errorValue = this.errorValue ?? 'MCP 服务连接已断开。';
        }
        for (const v of this.virtuals) v.forceClose();
        this.onChange();
      });

      this.onChange();
      return init;
    } catch (cause) {
      await client.close().catch(() => {});
      if (!this.disposed && gen === this.generation) {
        this.client = undefined;
        this.initResult = undefined;
        this.toolsValue = [];
        this.hasResourcesValue = false;
        if (isAuthError(cause)) {
          this.stateValue = 'needs-auth';
          this.errorValue = undefined;
        } else {
          this.stateValue = 'failed';
          this.errorValue = cause instanceof Error ? cause.message : String(cause);
        }
        this.onChange();
      }
      throw cause;
    }
  }

  private async disconnectActive(): Promise<void> {
    this.generation += 1;
    this.connectPromise = undefined;
    const prev = this.client;
    this.client = undefined;
    this.initResult = undefined;
    this.toolsValue = [];
    this.hasResourcesValue = false;
    for (const v of this.virtuals) v.forceClose();
    if (prev) {
      await prev.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    this.disposed = true;
    await this.disconnectActive();
  }
}
