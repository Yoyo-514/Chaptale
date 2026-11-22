import type {
  CloudAuthResult,
  CloudBackup,
  CloudDeleteBackupResult,
  CloudFailure,
  CloudListBackupsResult,
  CloudProvider,
  CloudSyncState,
  CloudUploadBackupResult
} from '../../../bridge/cloud-sync';
import { CloudAccounts } from './accounts';
import type { CloudCredential, CloudProviderAdapter, CloudRemoteEntry } from './providers/provider-port';
import type { CloudSyncStore } from './store';

const isBackup = (entry: CloudRemoteEntry) => entry.kind === 'file' && entry.name.endsWith('.chaptale');

/** 只拆末尾的统计标记，保留网盘加上的重名编号。 */
function describeBackupName(name: string): Pick<CloudBackup, 'name' | 'summary'> {
  const match = /_m(\d+)-r(\d+)-i(\d+)( \(\d+\)| \d+)?\.chaptale$/.exec(name);
  if (!match) return { name };
  return {
    name: `${name.slice(0, match.index)}${match[4] ?? ''}.chaptale`,
    summary: { manuscripts: Number(match[1]), resources: Number(match[2]), images: Number(match[3]) }
  };
}

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

  /** 作品包放在应用专属目录顶层；云端已有同名文件时由服务商改名，不覆盖。 */
  uploadBackup(provider: CloudProvider, name: string, bytes: Uint8Array): Promise<CloudUploadBackupResult> {
    return this.withAccount(provider, async (adapter, credential) => ({
      ok: true,
      name: (await adapter.upload({ credential, name, bytes })).name
    }));
  }

  listBackups(provider: CloudProvider): Promise<CloudListBackupsResult> {
    return this.withAccount(provider, async (adapter, credential) => ({
      ok: true,
      backups: (await adapter.listEntries({ credential }))
        .filter(isBackup)
        .map(({ id, name, modifiedAt, size }) => ({ id, ...describeBackupName(name), modifiedAt, size }))
    }));
  }

  downloadBackup(provider: CloudProvider, fileId: string): Promise<{ ok: true; bytes: Uint8Array } | CloudFailure> {
    return this.withAccount(provider, async (adapter, credential) => ({
      ok: true,
      bytes: await adapter.download({ credential, fileId })
    }));
  }

  deleteBackup(provider: CloudProvider, fileId: string): Promise<CloudDeleteBackupResult> {
    return this.withAccount<CloudDeleteBackupResult>(provider, async (adapter, credential) => {
      await adapter.remove({ credential, entryId: fileId });
      return { ok: true };
    });
  }

  /** 未登录按账户给出的原因返回；服务商请求失败统一报成网络错误，带上服务商的说明。 */
  private async withAccount<T>(
    provider: CloudProvider,
    action: (adapter: CloudProviderAdapter, credential: CloudCredential) => Promise<T>
  ): Promise<T | CloudFailure> {
    const ready = await this.accounts.requireCredential(provider);
    if (!ready.ok) return ready;
    try {
      return await action(ready.adapter, ready.credential);
    } catch (error) {
      return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) };
    }
  }
}
