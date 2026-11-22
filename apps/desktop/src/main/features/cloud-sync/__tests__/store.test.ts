import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TokenVault, type SafeStorageLike } from '../../../infra/security/token-vault';
import { CloudSyncStore } from '../store';

/** 内存实现：与 Electron `safeStorage` 同形，只为验证存储行为而非加密强度。 */
const storage: SafeStorageLike = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async value => Buffer.from(`enc:${value}`, 'utf8'),
  decryptStringAsync: async encrypted => ({ result: encrypted.toString('utf8').replace(/^enc:/, '') })
};

let dir: string;
let file: string;
let store: CloudSyncStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-cloud-'));
  file = path.join(dir, '.chaptale', 'agent', 'cloud-sync.json');
  store = new CloudSyncStore(new TokenVault(storage), file);
});
afterEach(async () => {
  expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(dir)).toMatch(/^chaptale-cloud-/);
  await rm(dir, { recursive: true, force: true });
});

describe('云同步本机状态', () => {
  it('没有文件时账户为空，不凭空创建目录', async () => {
    expect(await store.listAccounts()).toEqual([]);
    expect(await store.readCredential('dropbox')).toBeNull();
  });
  it('保存后凭据加密落盘，展示投影与凭据读取各自成立', async () => {
    const account = await store.saveAccount({
      provider: 'dropbox',
      accountId: 'writer-id',
      displayName: 'writer@example.com',
      credential: { refreshToken: 'refresh-secret', accessToken: 'access-secret' }
    });

    expect(account.provider).toBe('dropbox');
    expect(account.displayName).toBe('writer@example.com');
    expect(account.connectedAt).toEqual(expect.any(String));
    expect(await store.listAccounts()).toEqual([
      { provider: 'dropbox', displayName: 'writer@example.com', connectedAt: account.connectedAt }
    ]);
    expect(await store.listBackupAccounts()).toEqual([{ provider: 'dropbox', accountId: 'writer-id' }]);
    expect(await store.readCredential('dropbox')).toEqual({
      refreshToken: 'refresh-secret',
      accessToken: 'access-secret'
    });

    const raw = await readFile(file, 'utf8');

    expect(raw).not.toContain('refresh-secret');
    expect(raw).toContain('writer@example.com');
  });
  it('重新打开同一文件仍能读回凭据，同服务商重复授权按覆盖处理', async () => {
    await store.saveAccount({
      provider: 'dropbox',
      accountId: 'first',
      displayName: '先到',
      credential: { refreshToken: 'first' }
    });
    await store.saveAccount({
      provider: 'dropbox',
      accountId: 'second',
      displayName: '后到',
      credential: { refreshToken: 'second' }
    });

    const reopened = new CloudSyncStore(new TokenVault(storage), file);

    expect(await reopened.listAccounts()).toEqual([expect.objectContaining({ displayName: '后到' })]);
    expect(await reopened.readCredential('dropbox', 'first')).toBeNull();
    expect(await reopened.readCredential('dropbox', 'second')).toEqual({ refreshToken: 'second' });
  });
  it('手改过的条目被逐条丢弃，不牵连同文件里的正常账户', async () => {
    await store.saveAccount({
      provider: 'dropbox',
      accountId: 'ok',
      displayName: '正常',
      credential: { refreshToken: 'ok' }
    });

    const raw = JSON.parse(await readFile(file, 'utf8')) as { accounts: unknown[] };

    raw.accounts.push(
      {
        provider: 'aliyun',
        accountId: 'test',
        displayName: '未知服务商',
        connectedAt: 'x',
        sealed: { encryption: 'encrypted', payload: '' }
      },
      {
        provider: 'onedrive',
        accountId: 'test',
        displayName: '',
        connectedAt: 'x',
        sealed: { encryption: 'encrypted', payload: '' }
      },
      { provider: 'onedrive', accountId: 'test', displayName: '少了凭据', connectedAt: 'x' },
      {
        provider: 'onedrive',
        accountId: 'test',
        displayName: '坏了凭据',
        connectedAt: 'x',
        sealed: { encryption: 'rot13', payload: '' }
      }
    );
    await writeFile(file, JSON.stringify(raw));

    const reopened = new CloudSyncStore(new TokenVault(storage), file);

    expect(await reopened.listAccounts()).toEqual([
      expect.objectContaining({ provider: 'dropbox', displayName: '正常' })
    ]);
  });
});
