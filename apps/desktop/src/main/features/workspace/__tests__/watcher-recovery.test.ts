import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkspaceChanged } from '@chaptale/ipc-contract';

import { RecoveryStore } from '../recovery';
import { WorkspaceWatcher } from '../watcher';

let root: string;
let workspace: string;
let watcher: WorkspaceWatcher;
let events: WorkspaceChanged[];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-watch-'));
  workspace = path.join(root, 'book');
  await mkdir(workspace);
  watcher = new WorkspaceWatcher();
  events = [];
  watcher.onChange(event => events.push(event));
});
afterEach(async () => {
  await watcher.dispose();
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root).startsWith('chaptale-watch-')).toBe(true);
  await rm(root, { recursive: true, force: true });
});
const changed = (relativePath: string) =>
  events.flatMap(event => event.changes).some(item => item.relativePath === relativePath);

describe('真实文件监听', () => {
  it('原子替换与连续修改都发布最终路径，不携带正文', async () => {
    await writeFile(path.join(workspace, 'chapter.md'), '旧文');
    await watcher.setRoot(workspace);
    await writeFile(path.join(workspace, '.chaptale-create-new.tmp'), '新文');
    await rename(path.join(workspace, '.chaptale-create-new.tmp'), path.join(workspace, 'chapter.md'));
    await expect.poll(() => changed('chapter.md'), { timeout: 5000 }).toBe(true);
    events.length = 0;
    await writeFile(path.join(workspace, 'chapter.md'), '紧随原子保存的外部更新');
    await expect.poll(() => changed('chapter.md'), { timeout: 5000 }).toBe(true);
    expect(events.every(event => event.rootPath === workspace)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('紧随原子保存');
    expect(changed('.chaptale-create-new.tmp')).toBe(false);
  });

  it('新增和删除目录可感知，噪声目录不跟踪', async () => {
    await mkdir(path.join(workspace, 'node_modules'));
    await watcher.setRoot(workspace);
    await writeFile(path.join(workspace, 'node_modules/noise.md'), '噪声');
    await mkdir(path.join(workspace, '角色'));
    await writeFile(path.join(workspace, '角色/林晚.md'), '角色');
    await expect.poll(() => changed('角色/林晚.md'), { timeout: 5000 }).toBe(true);
    expect(changed('node_modules/noise.md')).toBe(false);
    await rm(path.join(workspace, '角色/林晚.md'));
    await expect
      .poll(
        () =>
          events.some(event =>
            event.changes.some(item => item.relativePath === '角色/林晚.md' && item.type === 'unlink')
          ),
        { timeout: 5000 }
      )
      .toBe(true);
  });

  it('切换工作区不再推送旧目录事件，不跟随内部链接', async () => {
    const other = path.join(root, 'other');
    await mkdir(other);
    await symlink(other, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await watcher.setRoot(workspace);
    await watcher.setRoot(other);
    events.length = 0;
    await writeFile(path.join(workspace, 'old.md'), '旧作品');
    await writeFile(path.join(other, 'new.md'), '新作品');
    await expect.poll(() => changed('new.md'), { timeout: 5000 }).toBe(true);
    expect(events.every(event => event.rootPath === other)).toBe(true);
    expect(changed('old.md')).toBe(false);
  });
});

describe('本机恢复草稿', () => {
  it('重建存储后可读，原文不写入作品且工作区隔离', async () => {
    const cacheRoot = path.join(root, 'cache');
    const store = new RecoveryStore(cacheRoot);
    const content = '\uFEFF甲\r\n乙\n丙\r';
    const args = { rootPath: workspace, relativePath: '正文/未保存.md', expectedHash: 'a'.repeat(64), content };
    await store.save(args);
    const reopened = new RecoveryStore(cacheRoot);
    expect(await reopened.read(workspace, args.relativePath)).toMatchObject(args);
    expect(await reopened.list(workspace)).toMatchObject([
      { relativePath: args.relativePath, sizeBytes: Buffer.byteLength(content) }
    ]);
    expect((await reopened.list(workspace))[0]).not.toHaveProperty('content');
    expect(await reopened.list(`${workspace}-other`)).toEqual([]);
    await expect(readFile(path.join(workspace, args.relativePath))).rejects.toHaveProperty('code', 'ENOENT');
    await reopened.discard(workspace, args.relativePath);
    expect(await reopened.read(workspace, args.relativePath)).toBeNull();
  });

  it('拒绝无效正文，显式覆盖前保留的副本与活动恢复稿分开', async () => {
    const cacheRoot = path.join(root, 'cache');
    const store = new RecoveryStore(cacheRoot);
    await expect(
      store.save({ rootPath: workspace, relativePath: 'a.md', expectedHash: '0'.repeat(64), content: '\uD800' })
    ).rejects.toThrow('UTF-8');
    await store.preserve(workspace, 'a.md', '外部版本');
    expect(await store.list(workspace)).toEqual([]);
  });
});
