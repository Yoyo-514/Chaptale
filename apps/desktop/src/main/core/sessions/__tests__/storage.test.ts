import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionStorageResolver } from '../storage';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-session-storage-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function createResolver(sessionsRootDir: string) {
  return new SessionStorageResolver({
    rootDir: root,
    cwd: '/workspace',
    sessionDir: path.join(sessionsRootDir, 'global'),
    sessionsRootDir
  });
}

describe('SessionStorageResolver', () => {
  it('ensureSessionDir 创建目录；getKnownSessionDirs 枚举全部子目录', async () => {
    const sessionsRoot = path.join(root, 'agent', 'sessions');
    const resolver = createResolver(sessionsRoot);

    const sessionDir = await resolver.ensureSessionDir();
    expect(sessionDir).toBe(path.join(sessionsRoot, 'global'));

    await mkdir(path.join(sessionsRoot, 'Workspace-abc'), { recursive: true });

    const dirs = await resolver.getKnownSessionDirs();

    expect(dirs).toEqual([path.join(sessionsRoot, 'global'), path.join(sessionsRoot, 'Workspace-abc')]);
  });

  it('deleteSessionFile 删除根内文件；拒绝根外路径', async () => {
    const sessionsRoot = path.join(root, 'agent', 'sessions');
    const resolver = createResolver(sessionsRoot);

    const target = path.join(sessionsRoot, 'global', 's1.jsonl');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'x');

    await resolver.deleteSessionFile(target);
    await expect(resolver.deleteSessionFile(path.join(root, 'outside.jsonl'))).rejects.toThrow(/outside sessions root/);
  });

  it('懒求值选项（函数形式）按调用时求值', async () => {
    let cwd = '/first';

    const resolver = new SessionStorageResolver({
      rootDir: root,
      cwd: () => cwd,
      sessionDir: path.join(root, 'sessions', 'global')
    });

    expect(await resolver.resolveCwd()).toBe('/first');
    cwd = '/second';
    expect(await resolver.resolveCwd()).toBe('/second');
  });
});

describe('getKnownSessionDirs', () => {
  it('列出所有作品的会话目录，当前作品排在首位', async () => {
    const sessionsRootDir = path.join(root, 'sessions');
    await mkdir(path.join(sessionsRootDir, 'Story-a'), { recursive: true });
    await mkdir(path.join(sessionsRootDir, 'Story-b'), { recursive: true });
    await writeFile(path.join(sessionsRootDir, 'stray.txt'), 'not a dir', 'utf8');

    const resolver = new SessionStorageResolver({
      rootDir: root,
      cwd: '/story-b',
      sessionDir: path.join(sessionsRootDir, 'Story-b'),
      sessionsRootDir
    });

    expect(await resolver.getKnownSessionDirs()).toEqual([
      path.join(sessionsRootDir, 'Story-b'),
      path.join(sessionsRootDir, 'Story-a')
    ]);
  });

  it('没有打开作品时只剩既存目录，不建当前目录', async () => {
    const sessionsRootDir = path.join(root, 'sessions');
    await mkdir(path.join(sessionsRootDir, 'Story-a'), { recursive: true });

    const resolver = new SessionStorageResolver({
      rootDir: root,
      cwd: '',
      sessionDir: '',
      sessionsRootDir
    });

    expect(await resolver.getKnownSessionDirs()).toEqual([path.join(sessionsRootDir, 'Story-a')]);
  });
});

describe('ensureSessionDir', () => {
  it('没有作品时拒绝建会话目录，避免落到进程 cwd', async () => {
    const resolver = new SessionStorageResolver({ rootDir: root, cwd: '', sessionDir: '' });

    await expect(resolver.ensureSessionDir()).rejects.toThrow('请先打开作品');
  });
});
