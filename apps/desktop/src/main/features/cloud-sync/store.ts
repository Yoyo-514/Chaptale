import type { CloudAccount, CloudProvider } from '../../../bridge/cloud-sync';
import { isCloudProvider } from '../../../bridge/cloud-sync';
import { readJsonFile, writeJsonFile } from '../../infra/filesystem/files';
import type { SealedSecret, TokenVault } from '../../infra/security/token-vault';
import type { CloudCredential } from './providers/provider-port';

/**
 * 云端账户的本机状态。
 *
 * 展示信息明文、凭据整体加密：显示名和连接时间要能直接读，token 一律经 `TokenVault`。
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

  private async readUnsafe(): Promise<CloudSyncFile> {
    const raw = await readJsonFile<Partial<CloudSyncFile>>(this.filePath);

    return {
      version: FILE_VERSION,
      accounts: sanitizeAccounts(raw?.accounts)
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

function isSealedSecret(value: unknown): value is SealedSecret {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<SealedSecret>;

  return (
    (candidate.encryption === 'encrypted' || candidate.encryption === 'plaintext') &&
    typeof candidate.payload === 'string'
  );
}
