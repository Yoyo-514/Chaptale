import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectWorkspaceSync, readOneDriveFolders, resolveDirectory, resolveOneDriveFolder } from '../sync';

let parent: string;
beforeEach(async () => {
  parent = await mkdtemp(path.join(os.tmpdir(), 'chaptale-sync-'));
});
afterEach(async () => {
  expect(path.dirname(path.resolve(parent))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(parent)).toMatch(/^chaptale-sync-/);
  await rm(parent, { recursive: true, force: true });
});

describe('OneDrive 本机目录', () => {
  it('没有配置和作品时不创建目录，也不宣称远端已同步', async () => {
    expect(await inspectWorkspaceSync(null, {})).toEqual({
      rootPath: null,
      folders: [],
      oneDriveRoot: null,
      remoteState: 'unknown',
      checkedAt: expect.any(String)
    });
    expect(await readdir(parent)).toEqual([]);
  });
  it('个人与默认目录去重，检测实际子目录并保留工作账号目录', async () => {
    const personal = path.join(parent, 'OneDrive');
    const business = path.join(parent, 'OneDrive - Work');
    const work = path.join(personal, '书稿', '新作品');
    await mkdir(work, { recursive: true });
    await mkdir(business);
    const state = await inspectWorkspaceSync(work, {
      OneDrive: personal,
      OneDriveConsumer: personal,
      OneDriveCommercial: business
    });
    expect(state.folders).toEqual([
      { path: await realpath(personal), kind: 'personal', available: true },
      { path: await realpath(business), kind: 'business', available: true }
    ]);
    expect(state.oneDriveRoot).toBe(await realpath(personal));
    expect(state.remoteState).toBe('unknown');
    expect((await inspectWorkspaceSync(personal, { OneDrive: personal })).oneDriveRoot).toBe(await realpath(personal));
  });
  it('同名前缀和跳出目录的链接不被认作同步作品', async () => {
    const cloud = path.join(parent, 'OneDrive');
    const outside = path.join(parent, 'OneDrive-copy');
    await mkdir(cloud);
    await mkdir(outside);
    await symlink(outside, path.join(cloud, 'linked-work'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await inspectWorkspaceSync(outside, { OneDrive: cloud })).oneDriveRoot).toBeNull();
    expect((await inspectWorkspaceSync(path.join(cloud, 'linked-work'), { OneDrive: cloud })).oneDriveRoot).toBeNull();
    expect(await readdir(outside)).toEqual([]);
  });
  it('缺失、文件和相对配置保留诊断，不能用于新建或打开', async () => {
    const file = path.join(parent, 'file.txt');
    await writeFile(file, '不是目录');
    const folders = await readOneDriveFolders({
      OneDriveConsumer: path.join(parent, 'missing'),
      OneDriveCommercial: file,
      OneDrive: 'relative'
    });
    expect(folders).toHaveLength(3);
    expect(folders.every(folder => !folder.available && Boolean(folder.error))).toBe(true);
    expect((await inspectWorkspaceSync(path.join(parent, 'missing'), {})).workspaceError).toBeTruthy();
    await expect(resolveDirectory('relative')).rejects.toThrow('绝对目录');
  });
  it('系统目录入口只接受当前配置中的完整根目录', async () => {
    const cloud = path.join(parent, 'OneDrive');
    const nested = path.join(cloud, '作品');
    await mkdir(nested, { recursive: true });
    expect(await resolveOneDriveFolder(cloud, { OneDrive: cloud })).toBe(await realpath(cloud));
    await expect(resolveOneDriveFolder(nested, { OneDrive: cloud })).rejects.toThrow('不在本机配置');
    await expect(resolveOneDriveFolder(parent, { OneDrive: cloud })).rejects.toThrow('不在本机配置');
    await expect(resolveOneDriveFolder(cloud, {})).rejects.toThrow('不在本机配置');
    await expect(resolveOneDriveFolder(path.join(parent, 'missing'), { OneDrive: cloud })).rejects.toThrow();
  });
});
