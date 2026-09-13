import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRestoreGuard } from '../restore-guard';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-guard-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedWorkspace(name = 'work') {
  const root = path.join(dir, name);

  await mkdir(path.join(root, '草稿'), { recursive: true });
  await writeFile(path.join(root, '正文.md'), '第一章\n');

  return root;
}

/** 同一秒内不许有第二份：快照名的粒度是秒，测试按秒错开。 */
function at(second: number): Date {
  return new Date(2026, 8, 13, 21, 4, second);
}

describe('还原前快照', () => {
  it('快照可以再解回一份完整作品，标识就是文件名里的时间戳', async () => {
    const root = await seedWorkspace();
    const guardRoot = path.join(dir, 'cache', 'work', 'restore-guard');
    const guard = await createRestoreGuard({ workspaceRoot: root, guardRoot, at: at(5) });

    expect(guard.id).toBe('20260913-210405');
    expect(await readdir(guardRoot)).toEqual(['20260913-210405.zip']);

    const { unpackArchive } = await import('../archive');
    const restored = path.join(dir, 'restored');

    await unpackArchive({ archivePath: path.join(guardRoot, `${guard.id}.zip`), targetPath: restored });

    expect(await readFile(path.join(restored, '正文.md'), 'utf8')).toBe('第一章\n');
    expect(await readdir(path.join(restored, '草稿'))).toEqual([]);
  });
  it('只留最近三份，按文件名里的时间戳而不是文件系统时间排序', async () => {
    const root = await seedWorkspace();
    const guardRoot = path.join(dir, 'cache', 'work', 'restore-guard');

    for (const second of [5, 3, 1, 4, 2]) {
      await createRestoreGuard({ workspaceRoot: root, guardRoot, at: at(second) });
    }

    // 五次快照之后，留下的必须是时间最晚的三份——与创建顺序无关。
    expect(await readdir(guardRoot)).toEqual(['20260913-210403.zip', '20260913-210404.zip', '20260913-210405.zip']);
  });
  it('打包失败时报错，且不留下半成品让下一次把它当成可用快照', async () => {
    const guardRoot = path.join(dir, 'cache', 'work', 'restore-guard');

    await expect(
      createRestoreGuard({ workspaceRoot: path.join(dir, '没有这个目录'), guardRoot, at: at(5) })
    ).rejects.toThrow();

    expect(await readdir(guardRoot)).toEqual([]);
  });
});
