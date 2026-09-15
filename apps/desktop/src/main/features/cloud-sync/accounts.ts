import { CLOUD_PROVIDER_LABELS, CLOUD_PROVIDERS } from '@chaptale/ipc-contract';
import type { CloudAuthResult, CloudProvider, CloudSyncState } from '@chaptale/ipc-contract';
import { errorToMessage } from '@chaptale/shared';

import { runAuthorizationCodeFlow } from './oauth-flow';
import type { CloudProviderAdapter } from './providers/provider-port';
import type { CloudSyncStore } from './store';
import type { CloudCredentialResult } from './types';

type AccountOptions = {
  adapters: CloudProviderAdapter[];
  store: CloudSyncStore;
  openExternal: (url: string) => Promise<void>;
};

/** 账户可用性、凭据读取与授权生命周期；作品绑定和操作锁由服务编排。 */
export class CloudAccounts {
  private authorizing: CloudProvider | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly options: AccountOptions) {}

  async getState(): Promise<CloudSyncState> {
    return {
      availability: CLOUD_PROVIDERS.map(provider => ({
        provider,
        configured: Boolean(this.adapter(provider)?.oauth())
      })),
      accounts: await this.options.store.listAccounts(),
      authorizing: this.authorizing
    };
  }

  async beginAuth(provider: CloudProvider): Promise<CloudAuthResult> {
    const adapter = this.adapter(provider);
    const oauth = adapter?.oauth();
    const label = CLOUD_PROVIDER_LABELS[provider];
    if (!adapter || !oauth) {
      return { ok: false, code: 'not-configured', message: `本构建未内置 ${label} 的应用凭据，无法登录` };
    }
    if (this.authorizing) {
      return {
        ok: false,
        code: 'failed',
        message: `正在等待 ${CLOUD_PROVIDER_LABELS[this.authorizing]} 的授权，请先完成或取消`
      };
    }

    this.authorizing = provider;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const flow = await runAuthorizationCodeFlow({
        ...oauth,
        openExternal: this.options.openExternal,
        signal: controller.signal
      });
      if (!flow.ok) return flow;
      const { credential, profile } = await adapter.exchangeCode({
        code: flow.code,
        codeVerifier: flow.codeVerifier,
        redirectUri: flow.redirectUri,
        signal: controller.signal
      });
      const account = await this.options.store.saveAccount({ provider, displayName: profile.displayName, credential });
      return { ok: true, account };
    } catch (error) {
      return controller.signal.aborted
        ? { ok: false, code: 'canceled', message: '已取消登录' }
        : { ok: false, code: 'network', message: `换取 ${label} 凭据失败：${errorToMessage(error)}` };
    } finally {
      this.authorizing = null;
      this.controller = null;
    }
  }

  cancelAuth(): void {
    this.controller?.abort();
  }

  async requireCredential(provider: CloudProvider): Promise<CloudCredentialResult> {
    const label = CLOUD_PROVIDER_LABELS[provider];
    const adapter = this.adapter(provider);
    if (!adapter?.oauth()) {
      return { ok: false, code: 'not-configured', message: `本构建未内置 ${label} 的应用凭据` };
    }
    const credential = await this.options.store.readCredential(provider);
    if (!credential) return { ok: false, code: 'not-signed-in', message: `请先登录 ${label}` };
    return { ok: true, adapter, credential };
  }

  private adapter(provider: CloudProvider) {
    return this.options.adapters.find(item => item.id === provider);
  }
}
