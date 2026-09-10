import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import { inspectWorkspaceEntry, mutateWorkspaceEntry } from '../entry-operations';
import { WorkspaceService } from '../service';

let root: string;
let workspace: string;
let service: WorkspaceService;
const original = '---\nid: linwan\nkind: character\ntitle: 林晚\ncustom: 0xFF # 保留\n---\n正文[[顾沉]]。\n';
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-entry-ops-'));
  workspace = path.join(root, '作品');
  await mkdir(workspace);
  await mkdir(path.join(workspace, '角色'));
  await writeFile(path.join(workspace, '角色/林晚.md'), original);
  service = new WorkspaceService({
    getStorageContext: async () => ({ workspacePath: workspace })
  });
});
afterEach(async () => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root).startsWith('chaptale-entry-ops-')).toBe(true);
  await rm(root, { recursive: true, force: true });
});
async function version(relativePath = '角色/林晚.md') {
  const result = await inspectWorkspaceEntry(service, { rootPath: workspace, relativePath });
  if (!result.ok) throw new Error(result.message);
  return result.entry.version;
}
describe('作者文件操作', () => {
  it('移动保持正文和元数据，不留下原路径', async () => {
    const result = await mutateWorkspaceEntry(service, {
      rootPath: workspace,
      relativePath: '角色/林晚.md',
      targetPath: '角色/晚.md',
      operation: 'move',
      expectedVersion: await version()
    });
    expect(result).toEqual({ ok: true, relativePath: '角色/晚.md' });
    expect(await readdir(path.join(workspace, '角色'))).toEqual(['晚.md']);
    expect(await readFile(path.join(workspace, '角色/晚.md'), 'utf8')).toBe(original);
  });
  it('资产副本生成新 id，保留未知字段、注释和正文', async () => {
    expect(
      await mutateWorkspaceEntry(service, {
        rootPath: workspace,
        relativePath: '角色/林晚.md',
        targetPath: '角色/副本.md',
        operation: 'duplicate',
        expectedVersion: await version()
      })
    ).toMatchObject({ ok: true });
    const copy = await readFile(path.join(workspace, '角色/副本.md'), 'utf8');
    const head = parseDocumentFrontmatter(copy);
    expect(head.status).toBe('ok');
    if (head.status === 'ok') expect(head.frontmatter.id).not.toBe('linwan');
    expect(copy).toContain('custom: 0xFF # 保留\n');
    expect(copy.endsWith('正文[[顾沉]]。\n')).toBe(true);
    expect(await readFile(path.join(workspace, '角色/林晚.md'), 'utf8')).toBe(original);
  });
  it('外部变化使旧确认失效', async () => {
    const expectedVersion = await version();
    await writeFile(path.join(workspace, '角色/林晚.md'), '外部新稿');
    expect(
      await mutateWorkspaceEntry(service, {
        rootPath: workspace,
        relativePath: '角色/林晚.md',
        targetPath: '角色/新名.md',
        operation: 'move',
        expectedVersion
      })
    ).toMatchObject({ ok: false, message: expect.stringContaining('已变化') });
    expect(await readdir(path.join(workspace, '角色'))).toEqual(['林晚.md']);
  });
  it('不覆盖已有文件或目录', async () => {
    await writeFile(path.join(workspace, '角色/顾沉.md'), '已有内容');
    for (const operation of ['move', 'duplicate'] as const) {
      expect(
        await mutateWorkspaceEntry(service, {
          rootPath: workspace,
          relativePath: '角色/林晚.md',
          targetPath: '角色/顾沉.md',
          operation,
          expectedVersion: await version()
        })
      ).toMatchObject({ ok: false });
    }
    expect(await readFile(path.join(workspace, '角色/顾沉.md'), 'utf8')).toBe('已有内容');
    await mkdir(path.join(workspace, '目录A'));
    await mkdir(path.join(workspace, '目录B'));
    expect(
      await mutateWorkspaceEntry(service, {
        rootPath: workspace,
        relativePath: '目录A',
        targetPath: '目录B',
        operation: 'move',
        expectedVersion: await version('目录A')
      })
    ).toMatchObject({ ok: false });
  });
  it('目录确认覆盖其子文件变化', async () => {
    await mkdir(path.join(workspace, '资料'));
    await writeFile(path.join(workspace, '资料/笔记.txt'), '初稿');
    const expectedVersion = await version('资料');
    await writeFile(path.join(workspace, '资料/笔记.txt'), '新稿');
    expect(
      await mutateWorkspaceEntry(service, {
        rootPath: workspace,
        relativePath: '资料',
        targetPath: '新资料',
        operation: 'move',
        expectedVersion
      })
    ).toMatchObject({ ok: false });
  });
  it('保护资料库根目录，回收站缺失时不退化为永久删除', async () => {
    const info = await inspectWorkspaceEntry(service, { rootPath: workspace, relativePath: '角色' });
    expect(info).toMatchObject({ ok: true, entry: { protectedReason: expect.any(String) } });
    expect(
      await mutateWorkspaceEntry(service, {
        rootPath: workspace,
        relativePath: '角色/林晚.md',
        operation: 'trash',
        expectedVersion: await version()
      })
    ).toMatchObject({ ok: false, message: expect.stringContaining('没有删除') });
    expect(await readFile(path.join(workspace, '角色/林晚.md'), 'utf8')).toBe(original);
  });
  it('拒绝作品错配、穿越和越界链接', async () => {
    const expectedVersion = await version();
    for (const targetPath of ['../越界.md', '.chaptale/秘密.md', 'chaptale.json']) {
      expect(
        await mutateWorkspaceEntry(service, {
          rootPath: workspace,
          relativePath: '角色/林晚.md',
          targetPath,
          operation: 'move',
          expectedVersion
        })
      ).toMatchObject({ ok: false });
    }
    expect(await inspectWorkspaceEntry(service, { rootPath: root, relativePath: '作品/角色/林晚.md' })).toMatchObject({
      ok: false
    });
    const outside = path.join(root, '外部');
    await mkdir(outside);
    await symlink(outside, path.join(workspace, '链接'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(
      await mutateWorkspaceEntry(service, {
        rootPath: workspace,
        relativePath: '角色/林晚.md',
        targetPath: '链接/林晚.md',
        operation: 'move',
        expectedVersion
      })
    ).toMatchObject({ ok: false });
    expect(await readdir(outside)).toEqual([]);
  });
});
