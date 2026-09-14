import path from 'node:path';

import type { CloudBinding } from '@chaptale/ipc-contract';

import { TokenVault, type SafeStorageLike } from '../../../infra/security/token-vault';
import type { CloudProviderAdapter } from '../providers/provider-port';
import { CloudSyncService } from '../service';
import { CloudSyncStore } from '../store';

/**
 * 云同步测试的共用夹具。
 *
 * 抽出来是因为它被恢复与自动备份两处用：夹具一旦复制成两份，两边测的就不再是同一个东西，
 * 而这类分叉只会在现场炸——测试里是全绿的。
 */

export const testStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: encrypted => encrypted.toString('utf8').replace(/^enc:/, '')
};

export const TEST_WORKSPACE_ID = '11111111-2222-3333-4444-555555555555';

export const testBinding: CloudBinding = {
  provider: 'dropbox',
  folderId: '/备份',
  folderName: '备份',
  boundAt: '2026-09-13T00:00:00.000Z'
};

/**
 * 内存远端：实现同一个端口。
 *
 * 这是**第二个实现**而不是 mock：被测对象是备份与恢复的逻辑，不是服务商的报文（那是适配器固定夹具的事）。
 */
export function createMemoryRemote() {
  const files = new Map<string, Uint8Array>();
  const downloads: string[] = [];
  const uploads: string[] = [];
  const adapter: CloudProviderAdapter = {
    id: 'dropbox',
    topLevelIsAppScoped: true,
    oauth: () => ({
      clientId: 'test',
      authorizeEndpoint: 'https://example.com/authorize',
      scopes: [],
      redirectPort: 52475,
      redirectUri: port => `http://127.0.0.1:${port}/`
    }),
    exchangeCode: async () => ({ credential: {}, profile: { displayName: '测试账户' } }),
    listEntries: async () => ({
      current: { id: null, name: '备份', root: false },
      parentId: null,
      entries: [...files.entries()].map(([name, bytes]) => ({
        id: name,
        name,
        kind: 'file' as const,
        size: bytes.byteLength
      }))
    }),
    createFolder: async input => ({ id: input.name, name: input.name, kind: 'folder' }),
    upload: async input => {
      files.set(input.name, input.bytes);
      uploads.push(input.name);

      return { id: input.name, name: input.name, kind: 'file', size: input.bytes.byteLength };
    },
    download: async input => {
      downloads.push(input.fileId);

      const bytes = files.get(input.fileId);

      if (!bytes) throw new Error(`远端没有 ${input.fileId}`);

      return bytes;
    },
    quota: async () => ({ usedBytes: 1, totalBytes: 100 }),
    remove: async input => {
      files.delete(input.entryId);
    }
  };

  return {
    adapter,
    downloads,
    uploads,
    put: (name: string, bytes: Uint8Array) => files.set(name, bytes),
    /** 让下一次上传失败，用来验失败路径（网络断了、配额满了都是这一条）。 */
    failUpload: (message: string) => {
      adapter.upload = async () => {
        throw new Error(message);
      };
    },
    /** 让某个归档删不掉，用来验“一份没删掉不拖累其余”。 */
    failRemove: (entryId: string, message: string) => {
      const original = adapter.remove;

      adapter.remove = async input => {
        if (input.entryId === entryId) throw new Error(message);

        return original(input);
      };
    }
  };
}

/** 组装一套服务；`bound` 为假时不写绑定与凭据，用来验“没绑定就别动远端”。 */
export async function createSyncService(input: {
  dir: string;
  workspace: string;
  cacheRoot: string;
  bound?: boolean;
  remote?: ReturnType<typeof createMemoryRemote>;
  /** 自动备份的节奏偏好；默认关闭，好让手动路径的用例不受心跳影响。 */
  backupPreferences?: { auto: boolean; intervalMinutes: number };
}) {
  const remote = input.remote ?? createMemoryRemote();
  const store = new CloudSyncStore(new TokenVault(testStorage), path.join(input.dir, 'cloud-sync.json'));

  if (input.bound !== false) {
    await store.saveAccount({ provider: 'dropbox', displayName: '测试账户', credential: {} });
    await store.saveBinding(input.workspace, testBinding);
  }

  return {
    ...remote,
    store,
    instance: new CloudSyncService({
      adapters: [remote.adapter],
      store,
      openExternal: async () => undefined,
      resolveWorkspace: async () => ({
        status: 'ready',
        rootPath: input.workspace,
        id: TEST_WORKSPACE_ID,
        title: '长夜'
      }),
      readBackupPreferences: async () => input.backupPreferences ?? { auto: false, intervalMinutes: 1440 },
      cacheRoot: input.cacheRoot
    })
  };
}
