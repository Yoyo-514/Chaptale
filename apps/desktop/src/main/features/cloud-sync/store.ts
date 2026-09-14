import type { CloudAccount, CloudBinding, CloudProvider } from '@chaptale/ipc-contract';
import { isCloudProvider } from '@chaptale/ipc-contract';

import { readJsonFile, writeJsonFile } from '../../infra/filesystem/files';
import type { SealedSecret, TokenVault } from '../../infra/security/token-vault';
import type { CloudCredential } from './providers/provider-port';

/**
 * 云同步的本机状态：账户与作品绑定。
 *
 * 展示信息明文、凭据整体加密：显示名、绑定时间要能直接读，token 一律经 `TokenVault`。
 * 一个服务商只保留一条账户记录，重复授权视为覆盖。
 */
export type StoredCloudAccount = {
  provider: CloudProvider;
  displayName: string;
  connectedAt: string;
  sealed: SealedSecret;
};

export type CloudSyncFile = {
  version: 1;
  accounts: StoredCloudAccount[];
  /** 作品绑定：作品绝对路径 → 远端备份目录。键约定与 settings.json 的会话槽位一致。 */
  bindings: Record<string, StoredCloudBinding>;
};

/**
 * 落盘的绑定多存一个“本机上次成功备份时间”。
 *
 * 它回答的是“**这台机器**上回什么时候备的”——其他设备备份不会更新它，所以它不假装知道云端的最新状态。
 */
export type StoredCloudBinding = CloudBinding & {
  lastBackupAt?: string;
  /** 自动备份最近一次失败的记录；成功一次就清掉（见契约里的 `CloudBackupFailure`）。 */
  lastBackupError?: { at: string; message: string };
};

const FILE_VERSION = 1;

export class CloudSyncStore {
  // 串行化读写：授权结束写入的同时点一次登出，读到的会是写了一半的文件。
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly vault: TokenVault,
    private readonly filePath: string
  ) {}

  /** 展示投影。凭据字段不进这个结果，过桥的只有账号信息。 */
  async listAccounts(): Promise<CloudAccount[]> {
    return this.enqueue(async () =>
      (await this.readUnsafe()).accounts.map(({ provider, displayName, connectedAt }) => ({
        provider,
        displayName,
        connectedAt
      }))
    );
  }

  async readCredential(provider: CloudProvider): Promise<CloudCredential | null> {
    return this.enqueue(async () => {
      const account = (await this.readUnsafe()).accounts.find(item => item.provider === provider);

      return account ? (JSON.parse(this.vault.open(account.sealed)) as CloudCredential) : null;
    });
  }

  async saveAccount(input: {
    provider: CloudProvider;
    displayName: string;
    credential: CloudCredential;
  }): Promise<CloudAccount> {
    return this.enqueue(async () => {
      const file = await this.readUnsafe();
      const record: StoredCloudAccount = {
        provider: input.provider,
        displayName: input.displayName,
        connectedAt: new Date().toISOString(),
        sealed: this.vault.seal(JSON.stringify(input.credential))
      };

      await this.writeUnsafe({
        ...file,
        accounts: [...file.accounts.filter(item => item.provider !== input.provider), record]
      });

      return { provider: record.provider, displayName: record.displayName, connectedAt: record.connectedAt };
    });
  }

  async removeAccount(provider: CloudProvider): Promise<void> {
    await this.enqueue(async () => {
      const file = await this.readUnsafe();

      await this.writeUnsafe({ ...file, accounts: file.accounts.filter(item => item.provider !== provider) });
    });
  }

  async readBinding(workspacePath: string): Promise<StoredCloudBinding | null> {
    return this.enqueue(async () => (await this.readUnsafe()).bindings[workspacePath] ?? null);
  }

  /** 重新绑到同一个目录时保留原有的备份时间与失败记录；换目录则清掉——那些不属于新位置。 */
  async saveBinding(workspacePath: string, binding: CloudBinding): Promise<void> {
    await this.enqueue(async () => {
      const file = await this.readUnsafe();
      const previous = file.bindings[workspacePath];
      const sameFolder = Boolean(previous && previous.folderId === binding.folderId);
      const keptAt = sameFolder ? previous?.lastBackupAt : undefined;
      const keptError = sameFolder ? previous?.lastBackupError : undefined;

      await this.writeUnsafe({
        ...file,
        bindings: {
          ...file.bindings,
          [workspacePath]: {
            ...binding,
            ...(keptAt ? { lastBackupAt: keptAt } : {}),
            ...(keptError ? { lastBackupError: keptError } : {})
          }
        }
      });
    });
  }

  /** 记下本机刚刚备份成功；没有绑定记录时什么都不做。 */
  async markBackup(workspacePath: string, at: string): Promise<void> {
    await this.enqueue(async () => {
      const file = await this.readUnsafe();
      const current = file.bindings[workspacePath];

      if (!current) {
        return;
      }

      // 成功一次就清掉上次失败的记录：留着它只会让“上次失败”一直挂在界面上。
      const { lastBackupError: _cleared, ...rest } = current;

      await this.writeUnsafe({
        ...file,
        bindings: { ...file.bindings, [workspacePath]: { ...rest, lastBackupAt: at } }
      });
    });
  }

  /** 记下自动备份最近一次失败；没有绑定记录时什么都不做。 */
  async markBackupFailure(workspacePath: string, failure: { at: string; message: string }): Promise<void> {
    await this.enqueue(async () => {
      const file = await this.readUnsafe();
      const current = file.bindings[workspacePath];

      if (!current) {
        return;
      }

      await this.writeUnsafe({
        ...file,
        bindings: { ...file.bindings, [workspacePath]: { ...current, lastBackupError: failure } }
      });
    });
  }

  async removeBinding(workspacePath: string): Promise<void> {
    await this.enqueue(async () => {
      const file = await this.readUnsafe();
      const bindings = { ...file.bindings };

      delete bindings[workspacePath];
      await this.writeUnsafe({ ...file, bindings });
    });
  }

  private async readUnsafe(): Promise<CloudSyncFile> {
    const raw = await readJsonFile<Partial<CloudSyncFile>>(this.filePath);

    return {
      version: FILE_VERSION,
      accounts: sanitizeAccounts(raw?.accounts),
      bindings: sanitizeBindings(raw?.bindings)
    };
  }

  private async writeUnsafe(file: CloudSyncFile) {
    await writeJsonFile(this.filePath, file);
  }

  /** 单次失败只影响调用方，不得阻塞队列中的后续操作。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);

    return run;
  }
}

/** 手改过的文件要能活着读出来：认不出的条目丢弃，而不是让整份文件失效。 */
function sanitizeAccounts(raw: unknown): StoredCloudAccount[] {
  const accounts = new Map<CloudProvider, StoredCloudAccount>();

  if (!Array.isArray(raw)) {
    return [];
  }

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    if (!isCloudProvider(entry.provider)) continue;
    if (typeof entry.displayName !== 'string' || !entry.displayName) continue;
    if (typeof entry.connectedAt !== 'string' || !entry.connectedAt) continue;
    if (!isSealedSecret(entry.sealed)) continue;

    accounts.set(entry.provider, {
      provider: entry.provider,
      displayName: entry.displayName,
      connectedAt: entry.connectedAt,
      sealed: entry.sealed
    });
  }

  return [...accounts.values()];
}

function sanitizeBindings(raw: unknown): Record<string, StoredCloudBinding> {
  const bindings: Record<string, StoredCloudBinding> = {};

  if (!raw || typeof raw !== 'object') {
    return bindings;
  }

  for (const [workspacePath, entry] of Object.entries(raw)) {
    if (!workspacePath || !entry || typeof entry !== 'object') continue;
    if (!isCloudProvider(entry.provider)) continue;
    if (typeof entry.folderId !== 'string') continue;
    if (typeof entry.folderName !== 'string' || !entry.folderName) continue;
    if (typeof entry.boundAt !== 'string' || !entry.boundAt) continue;

    const failure = sanitizeFailure(entry.lastBackupError);

    bindings[workspacePath] = {
      provider: entry.provider,
      folderId: entry.folderId,
      folderName: entry.folderName,
      boundAt: entry.boundAt,
      ...(typeof entry.lastBackupAt === 'string' && entry.lastBackupAt ? { lastBackupAt: entry.lastBackupAt } : {}),
      ...(failure ? { lastBackupError: failure } : {})
    };
  }

  return bindings;
}

/** 清洗失败记录：时间与说明都得是非空字符串，否则整条丢弃。 */
function sanitizeFailure(value: unknown): { at: string; message: string } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const { at, message } = value as { at?: unknown; message?: unknown };

  return typeof at === 'string' && at && typeof message === 'string' && message ? { at, message } : null;
}

function isSealedSecret(value: unknown): value is SealedSecret {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<SealedSecret>;

  return (
    (candidate.encryption === 'encrypted' || candidate.encryption === 'plaintext') &&
    typeof candidate.payload === 'string'
  );
}
