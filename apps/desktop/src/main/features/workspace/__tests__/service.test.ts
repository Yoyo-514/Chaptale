import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceService } from '../service';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const settings = (root: string | null) => ({
  getStorageContext: async (): Promise<{ workspacePath: string | undefined }> =>
    root ? { workspacePath: root } : { workspacePath: undefined }
});

describe('WorkspaceService', () => {
  it('returns no-workspace without a workspace', async () => {
    const result = await new WorkspaceService(settings(null)).listDirectory({ relativePath: '' });
    expect(result).toMatchObject({ ok: false, code: 'no-workspace' });
  });
  it('lists one level, hides internal directories, and sorts directories first', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-workspace-'));
    dirs.push(root);
    await mkdir(path.join(root, '第10章'));
    await mkdir(path.join(root, '.chaptale'));
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, '第2章.md'), 'x');
    const result = await new WorkspaceService(settings(root)).listDirectory({ relativePath: '' });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.entries.map(entry => entry.name)).toEqual(['第10章', '第2章.md']);
  });
  it('rejects a path outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-workspace-'));
    dirs.push(root);
    const result = await new WorkspaceService(settings(root)).listDirectory({ relativePath: '../outside' });
    expect(result).toMatchObject({ ok: false, code: 'outside-workspace' });
  });

  it('显示应用内部目录仍不扫描依赖，区分不存在与非目录', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-workspace-'));
    dirs.push(root);
    await mkdir(path.join(root, '.chaptale'));
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, '正文.md'), '正文');
    const service = new WorkspaceService(settings(root));
    expect(await service.listDirectory({ relativePath: '', includeInternal: true })).toMatchObject({
      ok: true,
      entries: [{ name: '.chaptale' }, { name: '正文.md' }]
    });
    expect(await service.listDirectory({ relativePath: 'missing' })).toMatchObject({ ok: false, code: 'not-found' });
    expect(await service.listDirectory({ relativePath: '正文.md' })).toMatchObject({
      ok: false,
      code: 'not-a-directory'
    });
  });

  it('列表不跟随链接，直接请求越界链接也被拒绝', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-workspace-'));
    dirs.push(root);
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(outside, path.join(workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const service = new WorkspaceService(settings(workspace));
    expect(await service.listDirectory({ relativePath: '' })).toEqual({ ok: true, entries: [] });
    expect(await service.listDirectory({ relativePath: 'link' })).toMatchObject({
      ok: false,
      code: 'outside-workspace'
    });
  });

  it('新建文件与目录，并回传创建出的条目', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-workspace-'));
    dirs.push(root);
    await mkdir(path.join(root, '正文'));
    const service = new WorkspaceService(settings(root));

    const file = await service.createEntry({ relativePath: '正文/第一章.md', kind: 'file' });
    const directory = await service.createEntry({ relativePath: '设定', kind: 'directory' });

    expect(file).toEqual({ ok: true, entry: { name: '第一章.md', relativePath: '正文/第一章.md', kind: 'file' } });
    expect(directory).toEqual({ ok: true, entry: { name: '设定', relativePath: '设定', kind: 'directory' } });

    const listed = await service.listDirectory({ relativePath: '正文' });
    if (listed.ok) expect(listed.entries.map(entry => entry.name)).toEqual(['第一章.md']);
  });

  it('同名条目一律报错而不覆盖已有内容', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-workspace-'));
    dirs.push(root);
    await writeFile(path.join(root, '第一章.md'), '已写好的正文');
    const service = new WorkspaceService(settings(root));

    const file = await service.createEntry({ relativePath: '第一章.md', kind: 'file' });

    expect(file).toMatchObject({ ok: false, code: 'already-exists' });
    // 正文不能被您声截断。
    expect(await readFile(path.join(root, '第一章.md'), 'utf8')).toBe('已写好的正文');
  });

  it('拒绝非法名称、路径穿越与无作品时的新建', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-workspace-'));
    dirs.push(root);
    const service = new WorkspaceService(settings(root));

    expect(await service.createEntry({ relativePath: '章节?.md', kind: 'file' })).toMatchObject({
      ok: false,
      code: 'invalid-name'
    });
    // Windows 会静默吃掉结尾的点，落盘名与输入不一致。
    expect(await service.createEntry({ relativePath: '章节.', kind: 'directory' })).toMatchObject({
      ok: false,
      code: 'invalid-name'
    });
    expect(await service.createEntry({ relativePath: 'CON', kind: 'file' })).toMatchObject({
      ok: false,
      code: 'invalid-name'
    });
    expect(await service.createEntry({ relativePath: '../outside.md', kind: 'file' })).toMatchObject({
      ok: false,
      code: 'outside-workspace'
    });
    expect(
      await new WorkspaceService(settings(null)).createEntry({ relativePath: 'a.md', kind: 'file' })
    ).toMatchObject({ ok: false, code: 'no-workspace' });
  });
});
