import { readFile, stat } from 'node:fs/promises';

import type {
  CloudAuthResult,
  CloudDeleteBackupResult,
  CloudFailure,
  CloudListBackupsResult,
  CloudProvider,
  CloudSyncState
} from '../../../bridge/cloud-sync';
import { CloudAccounts } from './accounts';
import { parseBackupName } from './package-name';
import type { CloudCredential, CloudProviderAdapter, CloudRemoteEntry } from './providers/provider-port';
import type { CloudBackupAccount, CloudSyncStore } from './store';

type CloudTarget = CloudProvider | CloudBackupAccount;

const isBackup = (entry: CloudRemoteEntry) => entry.kind === 'file' && entry.name.endsWith('.chaptale');

export type CloudSyncServiceOptions = {
  /** 已接入的服务商适配器；未接入的不出现在这里，界面只显示配置说明。 */
  adapters: CloudProviderAdapter[];
  store: CloudSyncStore;
  /** 打开系统浏览器；装配层注入 `shell.openExternal`。 */
  openExternal: (url: string) => Promise<void>;
};

/** 云端账户入口：服务商可用性、授权、退出，以及应用专属目录里作品包的上传、列出与下载。 */
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

  listBackupAccounts(): Promise<CloudBackupAccount[]> {
    return this.options.store.listBackupAccounts();
  }

  /** 适配器先按服务商上限检查大小，再读取作品包。 */
  uploadBackup(
    target: CloudTarget,
    name: string,
    path: string,
    signal?: AbortSignal
  ): Promise<{ ok: true; entry: CloudRemoteEntry } | CloudFailure> {
    return this.withAccount(target, async (adapter, credential) => {
      signal?.throwIfAborted();
      const { size } = await stat(path);
      const entry = await adapter.upload({
        credential,
        name,
        size,
        readBytes: () => readFile(path, { signal }),
        signal
      });
      return { ok: true, entry };
    });
  }

  listBackups(target: CloudTarget, signal?: AbortSignal): Promise<CloudListBackupsResult> {
    return this.withAccount(target, async (adapter, credential) => ({
      ok: true,
      backups: (await adapter.listEntries({ credential, signal }))
        .filter(isBackup)
        .map(({ id, name, modifiedAt, size }) => {
          const info = parseBackupName(name);
          return { id, name, modifiedAt, size, ...(info && { info }) };
        })
    }));
  }

  downloadBackup(provider: CloudProvider, fileId: string): Promise<{ ok: true; bytes: Uint8Array } | CloudFailure> {
    return this.withAccount(provider, async (adapter, credential) => ({
      ok: true,
      bytes: await adapter.download({ credential, fileId })
    }));
  }

  deleteBackup(target: CloudTarget, fileId: string, signal?: AbortSignal): Promise<CloudDeleteBackupResult> {
    return this.withAccount<CloudDeleteBackupResult>(target, async (adapter, credential) => {
      await adapter.remove({ credential, entryId: fileId, signal });
      return { ok: true };
    });
  }

  /** 未登录按账户给出的原因返回；服务商请求失败统一报成网络错误，带上服务商的说明。 */
  private async withAccount<T>(
    target: CloudTarget,
    action: (adapter: CloudProviderAdapter, credential: CloudCredential) => Promise<T>
  ): Promise<T | CloudFailure> {
    const ready =
      typeof target === 'string'
        ? await this.accounts.requireCredential(target)
        : await this.accounts.requireCredential(target.provider, target.accountId);
    if (!ready.ok) return ready;
    try {
      return await action(ready.adapter, ready.credential);
    } catch (error) {
      return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) };
    }
  }
}
