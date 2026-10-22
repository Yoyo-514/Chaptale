import type {
  CloudAuthResult,
  CloudListFoldersArgs,
  CloudListFoldersResult,
  CloudProvider,
  CloudSyncState
} from '../../../bridge/cloud-sync';
import { CloudAccounts } from './accounts';
import type { CloudProviderAdapter } from './providers/provider-port';
import type { CloudSyncStore } from './store';

export type CloudSyncServiceOptions = {
  /** 已接入的服务商适配器；未接入的不出现在这里，界面只显示配置说明。 */
  adapters: CloudProviderAdapter[];
  store: CloudSyncStore;
  /** 打开系统浏览器；装配层注入 `shell.openExternal`。 */
  openExternal: (url: string) => Promise<void>;
};

/** 云端账户入口：服务商可用性、授权、退出与目录浏览；作品备份随新存储另行接入。 */
export class CloudSyncService {
  private readonly accounts: CloudAccounts;

  constructor(private readonly options: CloudSyncServiceOptions) {
    this.accounts = new CloudAccounts(options);
  }

  getState(): Promise<CloudSyncState> {
    return this.accounts.getState();
  }

  /** 授权结束（成功/取消/超时/拒绝）才 resolve，界面据此显示等待状态。 */
  beginAuth(provider: CloudProvider): Promise<CloudAuthResult> {
    return this.accounts.beginAuth(provider);
  }

  async cancelAuth(): Promise<void> {
    this.accounts.cancelAuth();
  }

  /** 只清除本机凭据，不调用服务商撤销接口。 */
  async signOut(provider: CloudProvider): Promise<CloudSyncState> {
    await this.options.store.removeAccount(provider);
    return this.getState();
  }

  async listFolders(args: CloudListFoldersArgs): Promise<CloudListFoldersResult> {
    const ready = await this.accounts.requireCredential(args.provider);
    if (!ready.ok) return ready;
    try {
      const listing = await ready.adapter.listEntries({ credential: ready.credential, parentId: args.parentId });
      return {
        ok: true,
        current: listing.current,
        parentId: listing.parentId,
        folders: listing.entries
          .filter(entry => entry.kind === 'folder')
          .map(entry => ({ id: entry.id, name: entry.name, root: false }))
      };
    } catch (error) {
      return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) };
    }
  }
}
