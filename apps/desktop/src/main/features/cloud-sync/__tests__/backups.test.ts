import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import { openCreationStorage } from '@chaptale/storage';

import { TokenVault, type SafeStorageLike } from '../../../infra/security/token-vault';
import { backupName, CloudBackups } from '../backups';
import { createDropboxAdapter } from '../providers/dropbox/provider';
import { createOneDriveAdapter } from '../providers/onedrive/provider';
import { CloudSyncService } from '../service';
import { CloudSyncStore } from '../store';

const storage: SafeStorageLike = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async value => Buffer.from(`enc:${value}`, 'utf8'),
  decryptStringAsync: async encrypted => ({ result: encrypted.toString('utf8').replace(/^enc:/, '') })
};

let dir: string;
let source: CreationApplication;
let target: CreationApplication;
let store: CloudSyncStore;
/** 云端应用目录：文件名到内容；另放一份不是作品包的文件。 */
let remote: Map<string, ArrayBuffer>;
let oneDrivePackage: ArrayBuffer;
let onDropboxUpload: () => void;
let backups: CloudBackups;
let service: CloudSyncService;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-cloud-backups-'));
  source = new CreationApplication(await openCreationStorage({ rootDir: path.join(dir, '原库') }));
  target = new CreationApplication(await openCreationStorage({ rootDir: path.join(dir, '空库') }));
  store = new CloudSyncStore(new TokenVault(storage), path.join(dir, 'cloud-sync.json'));
  remote = new Map([['笔记.txt', new ArrayBuffer(1)]]);
  onDropboxUpload = () => {};
  const dropbox = createDropboxAdapter({
    fetch: async (url, init) => {
      const arg = () =>
        (JSON.parse((init!.headers as Record<string, string>)['dropbox-api-arg']!) as { path: string }).path.slice(1);
      if (String(url).endsWith('/token')) return Response.json({ access_token: 'short', expires_in: 3600 });
      if (String(url).endsWith('/upload')) {
        const name = arg();
        remote.set(name, await new Response(init!.body).arrayBuffer());
        onDropboxUpload();
        return Response.json({ name });
      }
      if (String(url).endsWith('/list_folder'))
        return Response.json({ entries: [...remote.keys()].map(name => ({ '.tag': 'file', name })) });
      if (String(url).endsWith('/download')) return new Response(remote.get(arg()));
      if (String(url).endsWith('/delete_v2')) {
        remote.delete((JSON.parse(String(init!.body)) as { path: string }).path.slice(1));
        return Response.json({});
      }
      throw new Error(`意外请求：${String(url)}`);
    }
  });
  const onedrive = createOneDriveAdapter({
    fetch: async (url, init) => {
      if (String(url).endsWith('/token')) return Response.json({ access_token: 'short', expires_in: 3600 });
      if (init?.method === 'PUT') {
        expect(String(url)).toContain('/special/approot:/');
        const name = decodeURIComponent(String(url).split('approot:/')[1]!.split(':/content')[0]!);
        oneDrivePackage = await new Response(init.body).arrayBuffer();
        return Response.json({ id: 'one-drive-backup', name: name.replace(/\.chaptale$/, ' 1.chaptale') });
      }
      throw new Error(`意外请求：${String(url)}`);
    }
  });
  service = new CloudSyncService({
    adapters: [dropbox, onedrive],
    store,
    openExternal: async () => {
      throw new Error('离线测试不打开浏览器');
    }
  });
  backups = new CloudBackups(
    service,
    (workId, file) => source.execute({ method: 'exportWorkPackage', input: { workId, path: file } }),
    file => source.execute({ method: 'inspectWorkPackage', input: { path: file } })
  );
});
afterEach(async () => {
  source.close();
  target.close();
  await rm(dir, { recursive: true, force: true });
});

function createWork() {
  const created = source.executeAuthor({
    method: 'createWork',
    input: { commandId: randomUUID(), title: '雨夜', kind: 'novel' }
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

it('云端文件名带作品标题与备份时间，标题里不能用作文件名的字符换成下划线', () => {
  expect(backupName('雨/夜\\?', new Date(2026, 0, 5, 9, 7), { manuscripts: 24, resources: 8, images: 3 })).toBe(
    '雨_夜___2026-01-05_0907_m24-r8-i3.chaptale'
  );
});

it('上传期间作品变化时，两家网盘仍收到同一份作品包，下载后可以导入', async () => {
  const work = createWork();
  await store.saveAccount({ provider: 'dropbox', displayName: '测试', credential: { refreshToken: 'offline' } });

  await store.saveAccount({ provider: 'onedrive', displayName: '测试', credential: { refreshToken: 'offline' } });
  onDropboxUpload = () => {
    const changed = source.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '上传期间新增',
        format: 'txt',
        content: '上传期间保存了新的内容。'
      }
    });
    if (!changed.ok) throw new Error(changed.error.message);
  };

  const onUpload = vi.fn();
  const uploaded = await backups.backupWork({ workId: work.id, title: work.title, target: 'all' }, onUpload);
  if (!uploaded.ok) throw new Error(uploaded.message);
  const dropboxUpload = uploaded.uploads[0]!.result;
  if (!dropboxUpload.ok) throw new Error(dropboxUpload.message);
  expect(uploaded.uploads).toEqual([
    {
      provider: 'dropbox',
      result: { ok: true, name: expect.stringMatching(/^雨夜_\d{4}-\d{2}-\d{2}_\d{4}_m0-r0-i0\.chaptale$/) }
    },
    { provider: 'onedrive', result: { ok: true, name: dropboxUpload.name.replace(/\.chaptale$/, ' 1.chaptale') } }
  ]);

  expect(onUpload.mock.calls).toEqual([
    [{ provider: 'dropbox', current: 1, total: 2 }],
    [{ provider: 'onedrive', current: 2, total: 2 }]
  ]);

  const listing = await service.listBackups('dropbox');
  if (!listing.ok) throw new Error(listing.message);
  expect(listing.backups).toHaveLength(1);
  expect([...remote.keys()]).toEqual(['笔记.txt', dropboxUpload.name]);
  expect(listing.backups[0]).toMatchObject({
    id: `/${dropboxUpload.name}`,
    name: dropboxUpload.name.replace('_m0-r0-i0', ''),
    summary: { manuscripts: 0, resources: 0, images: 0 }
  });
  expect(Buffer.from(oneDrivePackage).equals(Buffer.from(remote.get(dropboxUpload.name)!))).toBe(true);

  const first = await backups.downloadBackup({ provider: 'dropbox', fileId: listing.backups[0]!.id });
  if (!first.ok) throw new Error(first.message);
  try {
    expect(
      await target.execute({
        method: 'importWorkPackage',
        input: { commandId: randomUUID(), path: first.path, asCopy: false }
      })
    ).toMatchObject({ ok: true, value: { work: { id: work.id, title: '雨夜' } } });

    await backups.discardDownload(first.path);
    expect(existsSync(path.dirname(first.path))).toBe(false);
  } finally {
    await rm(path.dirname(first.path), { recursive: true, force: true });
  }

  expect(await service.deleteBackup('dropbox', listing.backups[0]!.id)).toEqual({ ok: true });
  expect(await service.listBackups('dropbox')).toEqual({ ok: true, backups: [] });
  expect([...remote.keys()]).toEqual(['笔记.txt']);
});

it('恢复列表从英文后缀提取摘要，保留重名编号，旧包仍可列出', async () => {
  await store.saveAccount({ provider: 'dropbox', displayName: '测试', credential: { refreshToken: 'offline' } });
  const renamed = '雨夜_m24-r8-i3 (1).chaptale';
  remote.set(renamed, new ArrayBuffer(1));
  remote.set('雨夜_m24-r8-i3 1.chaptale', new ArrayBuffer(1));
  remote.set('旧包.chaptale', new ArrayBuffer(1));
  remote.set('旧包.chaptale.summary.json', new ArrayBuffer(1));

  expect(await service.listBackups('dropbox')).toMatchObject({
    ok: true,
    backups: [
      { id: `/${renamed}`, name: '雨夜 (1).chaptale', summary: { manuscripts: 24, resources: 8, images: 3 } },
      {
        id: '/雨夜_m24-r8-i3 1.chaptale',
        name: '雨夜 1.chaptale',
        summary: { manuscripts: 24, resources: 8, images: 3 }
      },
      { id: '/旧包.chaptale', name: '旧包.chaptale' }
    ]
  });
  expect(await service.deleteBackup('dropbox', '/旧包.chaptale')).toEqual({ ok: true });
  expect(remote.has('旧包.chaptale.summary.json')).toBe(true);
});

it('选择 Dropbox 时只上传到 Dropbox，OneDrive 也已连接', async () => {
  const work = createWork();
  for (const provider of ['dropbox', 'onedrive'] as const) {
    await store.saveAccount({ provider, displayName: '测试', credential: { refreshToken: 'offline' } });
  }

  const result = await backups.backupWork({ workId: work.id, title: work.title, target: 'dropbox' }, () => {});
  expect(result).toEqual({
    ok: true,
    uploads: [{ provider: 'dropbox', result: { ok: true, name: expect.any(String) } }]
  });
});

it('没有登录或作品导出失败时报告原因，云端不多出文件', async () => {
  const work = createWork();
  expect(await backups.backupWork({ workId: work.id, title: work.title, target: 'all' }, () => {})).toMatchObject({
    ok: false,
    code: 'not-signed-in'
  });
  await store.saveAccount({ provider: 'dropbox', displayName: '测试', credential: { refreshToken: 'offline' } });
  expect(await backups.backupWork({ workId: randomUUID(), title: '不存在', target: 'all' }, () => {})).toMatchObject({
    ok: false,
    code: 'failed'
  });
  expect([...remote.keys()]).toEqual(['笔记.txt']);
});
