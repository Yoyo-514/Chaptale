import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CreateWorkspaceArgs } from '@chaptale/ipc-contract';

import { WorkspaceLayoutService } from '../../../core/workspace/layout';
import { createWorkspace } from '../create-workspace';
import { WorkspaceService } from '../service';

let parent: string;
let args: CreateWorkspaceArgs;
beforeEach(async () => {
  parent = await mkdtemp(path.join(os.tmpdir(), 'chaptale-new-work-'));
  args = {
    parentPath: parent,
    directoryName: '青岚',
    title: '青岚纪事',
    kind: 'novel',
    roles: ['characters', 'outline'],
    firstChapter: true,
    styleGuide: '第三人称有限视角。'
  };
});
afterEach(async () => {
  expect(path.dirname(path.resolve(parent))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(parent).startsWith('chaptale-new-work-')).toBe(true);
  await rm(parent, { recursive: true, force: true });
});

describe('新建作品', () => {
  it('创建可立即编辑的作品与守则，不需要模型', async () => {
    const result = await createWorkspace(args);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const layout = await new WorkspaceLayoutService().read(result.rootPath);
    expect(layout.manifest).toMatchObject({ version: 1, id: expect.any(String), title: '青岚纪事', kind: 'novel' });
    expect(layout.diagnostics).toEqual([]);
    expect(layout.roles.characters.exists).toBe(true);
    expect(layout.roles.threads.exists).toBe(false);
    const service = new WorkspaceService({
      getStorageContext: async () => ({ storageMode: 'workspace', workspacePath: result.rootPath })
    });
    expect(await service.getState()).toMatchObject({ displayName: '青岚纪事', hasChaptaleMetadata: true });
    expect(await service.readDocument({ rootPath: result.rootPath, relativePath: result.firstDocument })).toMatchObject(
      {
        ok: true,
        document: { head: { frontmatter: { kind: 'chapter', id: expect.any(String), order: 1 } } }
      }
    );
    expect(await readFile(path.join(result.rootPath, '设定/创作守则.md'), 'utf8')).toContain('第三人称有限视角。');
  });
  it('剧本可以不建首章，仅保留必要资料库', async () => {
    const result = await createWorkspace({ ...args, kind: 'script', roles: [], firstChapter: false, styleGuide: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.firstDocument).toBe('设定/创作守则.md');
    expect(await readdir(path.join(result.rootPath, '正文'))).toEqual([]);
    expect(JSON.parse(await readFile(path.join(result.rootPath, 'chaptale.json'), 'utf8')).kind).toBe('script');
  });
  it('已有目录和并发新建均不覆盖文件', async () => {
    await mkdir(path.join(parent, args.directoryName));
    await writeFile(path.join(parent, args.directoryName, '作者.txt'), '保留');
    expect(await createWorkspace(args)).toMatchObject({ ok: false, message: expect.stringContaining('同名目录') });
    expect(await readFile(path.join(parent, args.directoryName, '作者.txt'), 'utf8')).toBe('保留');
    const results = await Promise.all([
      createWorkspace({ ...args, directoryName: '同时' }),
      createWorkspace({ ...args, directoryName: '同时' })
    ]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toHaveLength(1);
  });
  it.each(['../outside', '..', '.', 'NUL', '结尾.', '末尾 ', '.chaptale', 'a/b', 'a\\b', 'x:y'])(
    '拒绝不安全目录名 %s',
    async directoryName => {
      expect(await createWorkspace({ ...args, directoryName })).toMatchObject({ ok: false });
      expect(await readdir(parent)).toEqual([]);
    }
  );
  it('拒绝相对位置、空标题和未知资料库，不留下半成品', async () => {
    for (const input of [
      { ...args, parentPath: '.' },
      { ...args, title: '  ' },
      { ...args, roles: ['unknown'] }
    ]) {
      expect(await createWorkspace(input as CreateWorkspaceArgs)).toMatchObject({ ok: false });
    }
    expect(await readdir(parent)).toEqual([]);
  });
});
