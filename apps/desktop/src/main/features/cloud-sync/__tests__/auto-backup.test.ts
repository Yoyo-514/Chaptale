import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutoBackupScheduler, shouldAutoBackup } from '../auto-backup';
import { createMemoryRemote, createSyncService } from './harness';

let dir: string;
let workspace: string;
let cacheRoot: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-auto-backup-'));
  workspace = path.join(dir, '长夜');
  cacheRoot = path.join(dir, 'cache');

  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(workspace, 'chaptale.json'),
    `${JSON.stringify({ version: 1, id: '11111111-2222-3333-4444-555555555555', title: '长夜', kind: 'novel' }, null, 2)}\n`
  );
  await writeFile(path.join(workspace, '正文.md'), '第一章\n');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('该不该自动备份', () => {
  const now = new Date('2026-09-14T22:00:00.000Z');

  it('从没备过就该备：这才是“绑定之后第一拍”该走的路', () => {
    expect(shouldAutoBackup({ now, lastBackupAt: null, intervalMinutes: 1440, busy: false })).toBe(true);
  });

  it('时间读不出来（手改坏的记录）也当成从没备过，而不是一直等一个不存在的起点', () => {
    expect(shouldAutoBackup({ now, lastBackupAt: '昨天', intervalMinutes: 1440, busy: false })).toBe(true);
  });

  it('间隔按分钟算，刚好够与差一分钟分别落在两边', () => {
    expect(
      shouldAutoBackup({ now, lastBackupAt: '2026-09-13T22:00:00.000Z', intervalMinutes: 1440, busy: false })
    ).toBe(true);
    expect(
      shouldAutoBackup({ now, lastBackupAt: '2026-09-13T22:01:00.000Z', intervalMinutes: 1440, busy: false })
    ).toBe(false);
  });

  it('已有备份或恢复在跑就不插队，也不排队', () => {
    expect(shouldAutoBackup({ now, lastBackupAt: null, intervalMinutes: 1440, busy: true })).toBe(false);
  });

  it('间隔越短越勤：30 分钟那一档在半小时后就该备', () => {
    expect(shouldAutoBackup({ now, lastBackupAt: '2026-09-14T21:31:00.000Z', intervalMinutes: 30, busy: false })).toBe(
      false
    );
    expect(shouldAutoBackup({ now, lastBackupAt: '2026-09-14T21:30:00.000Z', intervalMinutes: 30, busy: false })).toBe(
      true
    );
  });
});

describe('自动备份心跳', () => {
  it('到点就备一次：远端多出一份归档，本机上次备份时间被推进', async () => {
    const remote = await createSyncService({
      dir,
      workspace,
      cacheRoot,
      backupPreferences: { auto: true, intervalMinutes: 60 }
    });
    const now = new Date('2026-09-14T22:00:00.000Z');

    await remote.instance.autoBackupTick(now);

    expect(remote.uploads).toHaveLength(1);
    expect(remote.uploads[0]).toContain('长夜');
    expect(remote.uploads[0].endsWith('.zip')).toBe(true);

    const binding = await remote.store.readBinding(workspace);

    // 落盘的是**真实执行时间**，不是心跳传进去的那个时刻：那个只用于判断“到没到点”。
    expect(binding?.lastBackupAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(binding?.lastBackupAt ?? ''))).toBe(false);
    expect(binding?.lastBackupError).toBeUndefined();
  });

  it('没到点就一拍都不动：心跳是每分钟敲一次，不能每次都真去打包上传', async () => {
    const remote = await createSyncService({
      dir,
      workspace,
      cacheRoot,
      backupPreferences: { auto: true, intervalMinutes: 1440 }
    });
    const first = new Date('2026-09-14T22:00:00.000Z');

    await remote.instance.autoBackupTick(first);
    await remote.instance.autoBackupTick(new Date(first.getTime() + 60_000));

    expect(remote.uploads).toHaveLength(1);
  });

  it('关掉自动备份后，心跳直接返回', async () => {
    const remote = await createSyncService({
      dir,
      workspace,
      cacheRoot,
      backupPreferences: { auto: false, intervalMinutes: 1440 }
    });

    await remote.instance.autoBackupTick(new Date('2026-09-14T22:00:00.000Z'));

    expect(remote.uploads).toHaveLength(0);
    expect(await remote.store.readBinding(workspace).then(binding => binding?.lastBackupAt)).toBeUndefined();
  });

  it('没绑定就跳过：自动备份只做作者已经交代过的事', async () => {
    const remote = await createSyncService({
      dir,
      workspace,
      cacheRoot,
      bound: false,
      backupPreferences: { auto: true, intervalMinutes: 1440 }
    });

    await remote.instance.autoBackupTick(new Date('2026-09-14T22:00:00.000Z'));

    expect(remote.uploads).toHaveLength(0);
  });

  it('失败会留下一条记录（自动备份是静默的，不记就等于没发生），成功一次就清掉', async () => {
    const remote = await createSyncService({
      dir,
      workspace,
      cacheRoot,
      backupPreferences: { auto: true, intervalMinutes: 60 }
    });
    const failedAt = new Date('2026-09-14T22:00:00.000Z');

    remote.failUpload('网络断了');
    await remote.instance.autoBackupTick(failedAt);

    const afterFailure = await remote.store.readBinding(workspace);

    expect(afterFailure?.lastBackupError?.at).toBe(failedAt.toISOString());
    expect(afterFailure?.lastBackupError?.message).toContain('网络断了');
    expect(afterFailure?.lastBackupAt).toBeUndefined();

    // 下一拍（隔了足够久）成功一次：失败记录清掉，成功时间落下来。
    const recovered = await createSyncService({
      dir,
      workspace,
      cacheRoot,
      remote: createMemoryRemote(),
      backupPreferences: { auto: true, intervalMinutes: 60 }
    });

    await recovered.instance.autoBackupTick(new Date(failedAt.getTime() + 3_600_000));

    const afterSuccess = await recovered.store.readBinding(workspace);

    expect(afterSuccess?.lastBackupError).toBeUndefined();
    expect(afterSuccess?.lastBackupAt).toBeTruthy();
  });
});

describe('心跳的定时器', () => {
  it('按间隔敲；一拍跑得比间隔还久时，中间的拍次跳过而不是排队', async () => {
    vi.useFakeTimers();

    try {
      const starts: number[] = [];
      const scheduler = createAutoBackupScheduler({
        intervalMs: 60_000,
        tick: async () => {
          starts.push(Date.now());
          // 一拍 150 秒：跨过两个间隔，中间那两拍必须被跳过。
          await new Promise(resolve => setTimeout(resolve, 150_000));
        }
      });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(300_000);
      scheduler.stop();

      // 五分钟里有五拍（60/120/180/240/300 秒），真正开跑的只有两拍：
      // 60 秒那一拍跑到 210 秒，240 秒才空得出来，300 秒那拍还在跑。
      expect(starts).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
