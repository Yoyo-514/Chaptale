import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';
import { openCreationStorage } from '@chaptale/storage';

import type { ScheduledBackupFailure } from '../../../../bridge/scheduled-backup';
import { SettingsService } from '../../../core/settings/service';
import { TokenVault, type SafeStorageLike } from '../../../infra/security/token-vault';
import { backupName } from '../../cloud-sync/package-name';
import { createDropboxAdapter } from '../../cloud-sync/providers/dropbox/provider';
import { CloudSyncService } from '../../cloud-sync/service';
import { CloudSyncStore } from '../../cloud-sync/store';
import { ScheduledWorkBackups } from '../scheduled';

const device = { name: 'TEST-DESKTOP', installId: '1234cafe-f684-4c64-a037-4c27037a4b34' };
let root: string;
let dataDir: string;
let backupDir: string;
let app: CreationApplication;
let settings: SettingsService;
let scheduled: ScheduledWorkBackups;
let failures: ScheduledBackupFailure[];
let store: CloudSyncStore;
let cloud: CloudSyncService;
let remote: Map<string, Set<string>>;
let uploadUnavailable: boolean;
let holdUpload: ((signal: AbortSignal) => Promise<Response>) | undefined;

const storage: SafeStorageLike = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async text => Buffer.from(text),
  decryptStringAsync: async bytes => ({ result: bytes.toString() })
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-scheduled-test-'));
  dataDir = join(root, 'data');
  backupDir = join(root, 'backups');
  await mkdir(backupDir);
  app = new CreationApplication(await openCreationStorage({ rootDir: dataDir }));
  settings = new SettingsService({ rootDir: join(root, 'app') });
  await settings.setScheduledBackup({ enabled: true, directory: backupDir, intervalMinutes: 30 });
  failures = [];
  remote = new Map();
  uploadUnavailable = false;
  holdUpload = undefined;
  store = new CloudSyncStore(new TokenVault(storage), join(root, 'app', 'accounts.json'));
  const dropbox = createDropboxAdapter({
    fetch: async (url, init) => {
      if (String(url).endsWith('/token')) {
        return Response.json({ access_token: new URLSearchParams(String(init?.body)).get('refresh_token') });
      }
      const headers = new Headers(init?.headers);
      const packages = remote.get(headers.get('authorization')!.slice('Bearer '.length))!;
      if (String(url).endsWith('/list_folder'))
        return Response.json({ entries: [...packages].map(name => ({ '.tag': 'file', name })) });
      if (String(url).endsWith('/upload')) {
        if (holdUpload) return holdUpload(init!.signal!);
        if (uploadUnavailable) return new Response('暂时不可用', { status: 503 });
        const name = (JSON.parse(headers.get('dropbox-api-arg')!) as { path: string }).path.slice(1);
        packages.add(name);
        return Response.json({ name });
      }
      if (String(url).endsWith('/delete_v2')) {
        packages.delete((JSON.parse(String(init?.body)) as { path: string }).path.slice(1));
        return Response.json({});
      }
      throw new Error(`意外请求：${String(url)}`);
    }
  });
  cloud = new CloudSyncService({
    adapters: [dropbox],
    store,
    openExternal: async () => {
      throw new Error('离线测试不打开浏览器');
    }
  });
  scheduled = createScheduled();
});
afterEach(async () => {
  app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

function createScheduled() {
  return new ScheduledWorkBackups({
    creation: { request: (method, input) => app.execute({ method, input }) },
    settings,
    dataDirectory: async () => dataDir,
    cloud,
    device: async () => device,
    onChange: () => {},
    onFailure: failure => failures.push(failure)
  });
}
async function signIn(accountId: string) {
  const packages = remote.get(accountId) ?? new Set<string>();
  remote.set(accountId, packages);
  await store.saveAccount({
    provider: 'dropbox',
    accountId,
    displayName: '作者',
    credential: { refreshToken: accountId }
  });
  return packages;
}

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function workWithChapter(title = '雨夜') {
  const work = value(
    app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title, kind: 'novel' } })
  );
  const chapter = value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '第一章',
        format: 'txt',
        content: '夜里下着雨。'
      }
    })
  );
  return { work, chapter };
}

const names = () => readdir(backupDir);

it('首次为库里各部作品生成包，未改动时跳过；删掉一篇文稿只给这部作品新增一份', async () => {
  const { work, chapter } = workWithChapter();
  const second = workWithChapter('灯塔').work;

  await scheduled.runOnce({ upload: false });
  const initial = await names();
  expect(initial).toHaveLength(2);
  expect(initial).toEqual(
    expect.arrayContaining([expect.stringContaining(second.id), expect.stringContaining(work.id)])
  );
  expect((await scheduled.getState()).lastBackupAt).toEqual(expect.any(Number));
  await scheduled.runOnce({ upload: false });
  expect(await names()).toEqual(initial);

  value(
    app.executeAuthor({
      method: 'trashEntries',
      input: { commandId: randomUUID(), workId: work.id, entryIds: [chapter.id] }
    })
  );
  // 让数据库写入时间明确晚于原包，避免依赖文件系统的计时精度。
  const oldName = initial.find(name => name.includes(work.id))!;
  const deletionAt = new Date((await stat(join(backupDir, oldName))).mtimeMs + 1_000);
  await utimes(join(dataDir, 'works', work.id, 'work.sqlite'), deletionAt, deletionAt);
  await scheduled.runOnce({ upload: false });

  const added = (await names()).filter(name => !initial.includes(name));
  expect(added).toHaveLength(1);
  expect(added[0]).toContain(work.id);
  const restored = value(
    await app.execute({
      method: 'importWorkPackage',
      input: { commandId: randomUUID(), path: join(backupDir, added[0]!), asCopy: true }
    })
  );
  expect(value(app.executeAuthor({ method: 'listEntries', input: { workId: restored.work.id } }))).toEqual([]);
  expect(failures).toEqual([]);
});

it('云端连续失败只提示一次，本机照常保存；网络恢复只补传最新一份', async () => {
  const { work } = workWithChapter();
  const packages = await signIn('writer');
  uploadUnavailable = true;
  await scheduled.runOnce({ upload: true });
  const [first] = await names();
  expect(first).toBeDefined();
  expect(packages.size).toBe(0);
  expect(failures).toEqual([{ title: 'Dropbox 定时备份失败', message: expect.stringContaining('503') }]);
  expect((await scheduled.getState()).failures).toEqual(failures);

  const archived = join(backupDir, first!);
  const before = new Date('2020-03-01T09:00:00Z');
  await utimes(archived, before, before);
  value(
    app.executeAuthor({
      method: 'writeWritingGuidelines',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        writingGuidelines: '用限知视角写这一章。'
      }
    })
  );
  await scheduled.runOnce({ upload: true });
  const local = await names();
  const latest = local.find(name => name !== first)!;
  expect(local).toHaveLength(2);
  expect(packages.size).toBe(0);
  expect(failures).toHaveLength(1);

  uploadUnavailable = false;
  await scheduled.runOnce({ upload: true });
  expect(await names()).toEqual(local);
  expect([...packages]).toEqual([latest]);
  expect(failures).toHaveLength(1);
  expect((await scheduled.getState()).failures).toEqual([]);
});

it('同一账号重登保留已经上传的记录，新账号才接到最新备份', async () => {
  workWithChapter();
  const packages = await signIn('writer');
  await scheduled.runOnce({ upload: true });
  const [name] = await names();
  expect([...packages]).toEqual([name]);
  packages.delete(name!);
  await cloud.signOut('dropbox');
  await signIn('writer');

  const reopened = createScheduled();
  await reopened.runOnce({ upload: true });
  expect(packages.size).toBe(0);
  await cloud.signOut('dropbox');
  const other = await signIn('second-writer');
  await reopened.runOnce({ upload: true });
  expect([...other]).toEqual([name]);
});

it('本机和云端各留本安装最新十份，手动包和其他设备的包照常保留', async () => {
  const { work } = workWithChapter();
  const packages = await signIn('writer');
  const summary = { manuscripts: 1, resources: 0, images: 0 };
  const day = (index: number) => new Date(2020, 2, index, 10, 0);
  const automatic = Array.from({ length: 10 }, (_, index) => backupName(work, day(index + 1), 'auto', device, summary));
  const excluded = [
    backupName(work, day(1), 'manual', device, summary),
    backupName(work, day(1), 'auto', { name: device.name, installId: randomUUID() }, summary),
    '作者存档.chaptale'
  ];
  for (const [index, name] of [...automatic, ...excluded].entries()) {
    const path = join(backupDir, name);
    await writeFile(path, '已有备份');
    await utimes(path, day(index + 1), day(index + 1));
    packages.add(name);
  }

  await scheduled.runOnce({ upload: true });

  const local = await names();
  const added = local.find(name => !automatic.includes(name) && !excluded.includes(name));
  expect(added).toContain(work.id);
  expect(local.sort()).toEqual([...automatic.slice(1), ...excluded, added!].sort());
  expect([...packages].sort()).toEqual(local);
});

it('移动硬盘暂时拔出时保持开启，只通知一次；接回后下次检查继续保存', async () => {
  workWithChapter();
  const ejected = join(root, '移动硬盘');
  await rename(backupDir, ejected);
  await scheduled.runOnce({ upload: true });
  await scheduled.runOnce({ upload: true });
  expect(await scheduled.getState()).toMatchObject({
    settings: { enabled: true, directory: backupDir },
    folderError: expect.stringContaining('找不到备份文件夹'),
    lastBackupAt: null
  });
  expect(failures).toEqual([{ title: '备份文件夹不可用', message: expect.stringContaining('找不到备份文件夹') }]);

  await rename(ejected, backupDir);
  await scheduled.runOnce({ upload: true });
  expect(await names()).toHaveLength(1);
  expect(await scheduled.getState()).toMatchObject({ folderError: null, lastBackupAt: expect.any(Number) });
});

it('退出中止正在上传的包，随后只存本机；下次启动只补传最后一份', async () => {
  const { work } = workWithChapter();
  const packages = await signIn('writer');
  const uploading = Promise.withResolvers<AbortSignal>();
  holdUpload = signal =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      uploading.resolve(signal);
    });

  await scheduled.start();
  const signal = await uploading.promise;
  const [first] = await names();
  const old = new Date('2020-03-01T09:00:00Z');
  await utimes(join(backupDir, first!), old, old);
  value(
    app.executeAuthor({
      method: 'writeWritingGuidelines',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        writingGuidelines: '退出前最后一次保存。'
      }
    })
  );
  await scheduled.close();

  const local = await names();
  const latest = local.find(name => name !== first);
  expect(signal.aborted).toBe(true);
  expect(local).toHaveLength(2);
  expect(packages.size).toBe(0);
  expect(failures).toEqual([]);

  holdUpload = undefined;
  await createScheduled().runOnce({ upload: true });
  expect([...packages]).toEqual([latest]);
});

it('备份文件夹选在应用数据文件夹里时拒绝，原设置不变', async () => {
  const inside = join(dataDir, '备份');
  await mkdir(inside);
  await expect(scheduled.configure({ enabled: true, directory: inside, intervalMinutes: 30 })).rejects.toThrow(
    '备份文件夹不能放在应用数据文件夹里'
  );
  expect((await scheduled.getState()).settings.directory).toBe(backupDir);
});

it('定时备份关着时立即备份照常保存，开关仍关着；没有改动时报告没存', async () => {
  workWithChapter();
  workWithChapter('灯塔');
  await settings.setScheduledBackup({ enabled: false, directory: backupDir, intervalMinutes: 30 });

  await expect(scheduled.runOnce({ upload: true })).resolves.toEqual({ saved: 0, failures: [] });
  expect(await names()).toEqual([]);

  await expect(scheduled.runOnce({ upload: true, manual: true })).resolves.toEqual({ saved: 2, failures: [] });
  expect(await names()).toHaveLength(2);
  await expect(scheduled.runOnce({ upload: true, manual: true })).resolves.toEqual({ saved: 0, failures: [] });
  expect((await scheduled.getState()).settings.enabled).toBe(false);
});
