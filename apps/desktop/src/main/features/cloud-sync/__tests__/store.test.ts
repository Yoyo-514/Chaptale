import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CloudBinding } from '@chaptale/ipc-contract';

import { TokenVault, type SafeStorageLike } from '../../../infra/security/token-vault';
import { CloudSyncStore } from '../store';

/** 内存实现：与 Electron `safeStorage` 同形，只为验证存储行为而非加密强度。 */
const storage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: encrypted => encrypted.toString('utf8').replace(/^enc:/, '')
};

const binding: CloudBinding = {
  provider: 'dropbox',
  folderId: '/备份',
  folderName: '备份',
  boundAt: '2026-09-13T00:00:00.000Z'
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
  it('没有文件时账户与绑定都是空的，不凭空创建目录', async () => {
    expect(await store.listAccounts()).toEqual([]);
    expect(await store.readCredential('dropbox')).toBeNull();
    expect(await store.readBinding('/work/novel')).toBeNull();
  });
  it('保存后凭据加密落盘，展示投影与凭据读取各自成立', async () => {
    const account = await store.saveAccount({
      provider: 'dropbox',
      displayName: 'writer@example.com',
      credential: { refreshToken: 'refresh-secret', accessToken: 'access-secret' }
    });

    expect(account.provider).toBe('dropbox');
    expect(account.displayName).toBe('writer@example.com');
    expect(account.connectedAt).toEqual(expect.any(String));
    expect(await store.listAccounts()).toEqual([account]);
    expect(await store.readCredential('dropbox')).toEqual({
      refreshToken: 'refresh-secret',
      accessToken: 'access-secret'
    });

    const raw = await readFile(file, 'utf8');

    expect(raw).not.toContain('refresh-secret');
    expect(raw).toContain('writer@example.com');
  });
  it('重新打开同一文件仍能读回凭据，同服务商重复授权按覆盖处理', async () => {
    await store.saveAccount({ provider: 'dropbox', displayName: '先到', credential: { refreshToken: 'first' } });
    await store.saveAccount({ provider: 'dropbox', displayName: '后到', credential: { refreshToken: 'second' } });

    const reopened = new CloudSyncStore(new TokenVault(storage), file);

    expect(await reopened.listAccounts()).toEqual([expect.objectContaining({ displayName: '后到' })]);
    expect(await reopened.readCredential('dropbox')).toEqual({ refreshToken: 'second' });
  });
  it('账户与绑定各写各的，互不覆盖', async () => {
    await store.saveAccount({ provider: 'dropbox', displayName: 'a@example.com', credential: { refreshToken: 'a' } });
    await store.saveBinding('/work/novel', binding);

    const reopened = new CloudSyncStore(new TokenVault(storage), file);

    expect(await reopened.readBinding('/work/novel')).toEqual(binding);
    expect(await reopened.listAccounts()).toEqual([expect.objectContaining({ displayName: 'a@example.com' })]);

    // 登出只清凭据，绑定留着——重新登录后不必再选一次目录。
    await reopened.removeAccount('dropbox');

    expect(await reopened.listAccounts()).toEqual([]);
    expect(await reopened.readBinding('/work/novel')).toEqual(binding);

    await reopened.removeBinding('/work/novel');

    expect(await reopened.readBinding('/work/novel')).toBeNull();
  });
  it('记下本机上次备份时间；重绑同一目录保留，换目录清掉', async () => {
    await store.saveBinding('/work/novel', binding);
    await store.markBackup('/work/novel', '2026-09-13T21:04:05.000Z');

    expect((await store.readBinding('/work/novel'))?.lastBackupAt).toBe('2026-09-13T21:04:05.000Z');

    // 重绑到同一目录：那个备份确实发生在这个位置上。
    await store.saveBinding('/work/novel', { ...binding, boundAt: '2026-09-14T00:00:00.000Z' });
    expect((await store.readBinding('/work/novel'))?.lastBackupAt).toBe('2026-09-13T21:04:05.000Z');

    // 换到另一个目录：旧时间不属于新位置。
    await store.saveBinding('/work/novel', { ...binding, folderId: '/另一个', folderName: '另一个' });
    expect((await store.readBinding('/work/novel'))?.lastBackupAt).toBeUndefined();
  });
  it('没有绑定时记备份时间不会凭空造一条绑定出来', async () => {
    await store.markBackup('/work/novel', '2026-09-13T21:04:05.000Z');

    expect(await store.readBinding('/work/novel')).toBeNull();
  });
  it('手改过的条目被逐条丢弃，不牵连同文件里的正常账户与绑定', async () => {
    await store.saveAccount({ provider: 'dropbox', displayName: '正常', credential: { refreshToken: 'ok' } });
    await store.saveBinding('/work/novel', binding);

    const raw = JSON.parse(await readFile(file, 'utf8')) as { accounts: unknown[]; bindings: Record<string, unknown> };

    raw.accounts.push(
      {
        provider: 'aliyun',
        displayName: '未知服务商',
        connectedAt: 'x',
        sealed: { encryption: 'encrypted', payload: '' }
      },
      { provider: 'onedrive', displayName: '', connectedAt: 'x', sealed: { encryption: 'encrypted', payload: '' } },
      { provider: 'nutstore', displayName: '少了凭据', connectedAt: 'x' },
      { provider: 'nutstore', displayName: '坏了凭据', connectedAt: 'x', sealed: { encryption: 'rot13', payload: '' } }
    );
    raw.bindings['/work/broken'] = { provider: 'aliyun', folderId: '/x', folderName: 'x', boundAt: 'x' };
    await writeFile(file, JSON.stringify(raw));

    const reopened = new CloudSyncStore(new TokenVault(storage), file);

    expect(await reopened.listAccounts()).toEqual([
      expect.objectContaining({ provider: 'dropbox', displayName: '正常' })
    ]);
    expect(await reopened.readBinding('/work/novel')).toEqual(binding);
    expect(await reopened.readBinding('/work/broken')).toBeNull();
  });
});
