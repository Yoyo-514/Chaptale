import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getSessionScope, SessionStorageResolver } from '../storage';

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

describe('getSessionScope', () => {
  it('目录名 global → global，其余 → workspace', () => {
    expect(getSessionScope(path.join('a', 'b', 'global'))).toBe('global');
    expect(getSessionScope(path.join('a', 'b', 'Story-xyz'))).toBe('workspace');
  });
});
