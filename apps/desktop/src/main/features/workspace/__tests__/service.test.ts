import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceService } from '../service';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const settings = (root: string | null) => ({
  getStorageContext: async (): Promise<{ storageMode: 'global' | 'workspace'; workspacePath: string | undefined }> =>
    root ? { storageMode: 'workspace', workspacePath: root } : { storageMode: 'global', workspacePath: undefined }
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
});
