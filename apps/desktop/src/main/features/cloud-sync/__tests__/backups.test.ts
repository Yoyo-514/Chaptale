import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import { openCreationStorage } from '@chaptale/storage';

import { TokenVault, type SafeStorageLike } from '../../../infra/security/token-vault';
import { CloudBackups } from '../backups';
import { backupName, parseBackupName } from '../package-name';
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
const device = { name: 'DESKTOP-7F3K', installId: '1a2b3c4d-0000-4000-8000-000000000000' };

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
    file => source.execute({ method: 'inspectWorkPackage', input: { path: file } }),
    async () => device
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

it('备份文件名带作品、时间、来源和条目数，读回来得到同样的内容；别的命名认不出', () => {
  const work = { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', title: '雨/夜_?' };
  const at = new Date(2026, 0, 5, 9, 7);
  const name = backupName(work, at, 'auto', device, { manuscripts: 24, resources: 8, images: 3 });

  expect(name).toBe(
    '雨_夜___2026-01-05_0907_auto_DESKTOP-7F3K_1a2b3c4d_3f2504e0-4f89-41d3-9a0c-0305e82c3301_m24-r8-i3.chaptale'
  );
  const info = {
    workId: work.id,
    installIdPrefix: '1a2b3c4d',
    title: '雨_夜__',
    at: at.toISOString(),
    kind: 'auto',
    device: 'DESKTOP-7F3K',
    summary: { manuscripts: 24, resources: 8, images: 3 }
  };
  expect(parseBackupName(name)).toEqual(info);
  // 云端给重名文件加的编号不影响识别。
  expect(parseBackupName(name.replace('.chaptale', ' (1).chaptale'))).toEqual(info);
  expect(parseBackupName(name.replace('.chaptale', ' 1.chaptale'))).toEqual(info);
  expect(parseBackupName('雨夜_2026-01-05_0907_m24-r8-i3.chaptale')).toBeNull();
});

it('上传期间作品变化时，Dropbox 和 OneDrive 仍收到同一份作品包，下载后可以导入', async () => {
  const work = createWork();
  await store.saveAccount({
    provider: 'dropbox',
    accountId: 'test-account',
    displayName: '测试',
    credential: { refreshToken: 'offline' }
  });

  await store.saveAccount({
    provider: 'onedrive',
    accountId: 'test-account',
    displayName: '测试',
    credential: { refreshToken: 'offline' }
  });
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
  const uploaded = await backups.backupWork({ workId: work.id, target: 'all' }, onUpload);
  if (!uploaded.ok) throw new Error(uploaded.message);
  expect(uploaded.uploads).toEqual([
    { provider: 'dropbox', result: { ok: true } },
    { provider: 'onedrive', result: { ok: true } }
  ]);

  expect(onUpload.mock.calls).toEqual([
    [{ provider: 'dropbox', current: 1, total: 2 }],
    [{ provider: 'onedrive', current: 2, total: 2 }]
  ]);

  const listing = await service.listBackups('dropbox');
  if (!listing.ok) throw new Error(listing.message);
  expect(listing.backups).toHaveLength(1);
  const [, uploadedName] = [...remote.keys()];
  expect(remote.size).toBe(2);
  expect(listing.backups[0]).toMatchObject({
    id: `/${uploadedName}`,
    name: uploadedName,
    info: {
      workId: work.id,
      title: '雨夜',
      kind: 'manual',
      device: 'DESKTOP-7F3K',
      summary: { manuscripts: 0, resources: 0, images: 0 }
    }
  });
  expect(Buffer.from(oneDrivePackage).equals(Buffer.from(remote.get(uploadedName!)!))).toBe(true);

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

it('名字不是应用写的作品包照常列出，只是没有来源；不是作品包的文件不列', async () => {
  await store.saveAccount({
    provider: 'dropbox',
    accountId: 'test-account',
    displayName: '测试',
    credential: { refreshToken: 'offline' }
  });
  remote.set('旧包.chaptale', new ArrayBuffer(1));
  remote.set('旧包.chaptale.summary.json', new ArrayBuffer(1));

  expect(await service.listBackups('dropbox')).toEqual({
    ok: true,
    backups: [{ id: '/旧包.chaptale', name: '旧包.chaptale' }]
  });
  expect(await service.deleteBackup('dropbox', '/旧包.chaptale')).toEqual({ ok: true });
  expect(remote.has('旧包.chaptale.summary.json')).toBe(true);
});

it('选择 Dropbox 时只上传到 Dropbox，OneDrive 也已连接', async () => {
  const work = createWork();
  for (const provider of ['dropbox', 'onedrive'] as const) {
    await store.saveAccount({
      provider,
      accountId: 'test-account',
      displayName: '测试',
      credential: { refreshToken: 'offline' }
    });
  }

  const result = await backups.backupWork({ workId: work.id, target: 'dropbox' }, () => {});
  expect(result).toEqual({
    ok: true,
    uploads: [{ provider: 'dropbox', result: { ok: true } }]
  });
});

it('没有登录或作品导出失败时报告原因，云端不多出文件', async () => {
  const work = createWork();
  expect(await backups.backupWork({ workId: work.id, target: 'all' }, () => {})).toMatchObject({
    ok: false,
    code: 'not-signed-in'
  });
  await store.saveAccount({
    provider: 'dropbox',
    accountId: 'test-account',
    displayName: '测试',
    credential: { refreshToken: 'offline' }
  });
  expect(await backups.backupWork({ workId: randomUUID(), target: 'all' }, () => {})).toMatchObject({
    ok: false,
    code: 'failed'
  });
  expect([...remote.keys()]).toEqual(['笔记.txt']);
});
