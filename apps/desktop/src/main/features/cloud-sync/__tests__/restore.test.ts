import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toWorkspaceSessionDirName } from '../../../core/settings/workspace-session-directory';
import { packWorkspace, unpackArchive } from '../backup/archive';
import { createSyncService, TEST_WORKSPACE_ID as WORKSPACE_ID } from './harness';

const OTHER_WORKSPACE_ID = 'ffffffff-0000-0000-0000-000000000000';

let dir: string;
let workspace: string;
let cacheRoot: string;
let archivePath: string;

/**
 * 内存远端：实现同一个端口。
 *
 * 这是**第二个实现**而不是 mock——`docs/m7-plan/00-cloud-sync.md` §9 要的就是它：
 * 被测对象是恢复逻辑，不是 Dropbox 的报文（那是适配器固定夹具的事）。
 */
async function writeTree(root: string, files: Record<string, string>) {
  await mkdir(root, { recursive: true });

  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function manifest(id: string) {
  return `${JSON.stringify({ version: 1, id, title: '长夜', kind: 'novel' }, null, 2)}\n`;
}

/** 造一份“归档时的作品”并放到内存远端上：内容与当前作品不同，用它当恢复来源。 */
async function seedArchive(
  put: (name: string, bytes: Uint8Array) => void,
  files: Record<string, string>,
  workspaceId = WORKSPACE_ID
) {
  const staging = path.join(dir, 'staging');

  await rm(staging, { recursive: true, force: true });
  await writeTree(staging, { 'chaptale.json': manifest(workspaceId), ...files });
  // 空目录要单独留一个：归档靠目录条目保住它。
  await mkdir(path.join(staging, '.chaptale'), { recursive: true });
  await packWorkspace({ rootPath: staging, targetPath: archivePath });
  put('archive.zip', await readFile(archivePath));
}

function guardZip(snapshotId: string) {
  return path.join(cacheRoot, toWorkspaceSessionDirName(workspace), 'restore-guard', `${snapshotId}.zip`);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-restore-'));
  workspace = path.join(dir, 'work');
  cacheRoot = path.join(dir, 'cache');
  archivePath = path.join(dir, 'archive.zip');
  await mkdir(workspace, { recursive: true });
});
afterEach(async () => {
  expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(dir)).toMatch(/^chaptale-restore-/);
  await rm(dir, { recursive: true, force: true });
});

describe('恢复计划', () => {
  it('逐文件给出新增与冲突，本地独有只报个数', async () => {
    const { instance, put } = await createSyncService({ dir, workspace, cacheRoot });

    await writeTree(workspace, {
      'chaptale.json': manifest(WORKSPACE_ID),
      '正文.md': '改过的第一章\n',
      '番外.md': '只在本地\n'
    });
    await seedArchive(put, { '正文.md': '第一章\n', '灵感/片段.md': '片段\n' });

    const result = await instance.planRestore({ archiveId: 'archive.zip' });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.plan.identityMatches).toBe(true);
    // 清单按路径定序：两边一样的是“一致”，两边不同的是“冲突”，只在归档的是“新增”。
    expect(result.plan.entries.map(entry => [entry.relativePath, entry.verdict, entry.system])).toEqual([
      ['chaptale.json', 'identical', false],
      ['正文.md', 'conflict', false],
      ['灵感/片段.md', 'add', false]
    ]);
    expect(result.plan.emptyDirectories).toEqual(['.chaptale']);
    // 番外.md 只在本地：三种模式都不会动它。
    expect(result.plan.localOnly).toBe(1);
  });
  it('另一部作品的归档不能自证身份，覆盖与合并据此被挡住', async () => {
    const { instance, put } = await createSyncService({ dir, workspace, cacheRoot });

    await writeTree(workspace, { 'chaptale.json': manifest(WORKSPACE_ID), '正文.md': '第一章\n' });
    await seedArchive(put, { '正文.md': '别人的第一章\n' }, OTHER_WORKSPACE_ID);

    const plan = await instance.planRestore({ archiveId: 'archive.zip' });

    expect(plan.ok && plan.plan.identityMatches).toBe(false);

    const applied = await instance.applyRestore({ archiveId: 'archive.zip', mode: 'overwrite' });

    expect(applied.ok).toBe(false);
    expect(applied.ok ? '' : applied.message).toContain('不能自证');
    // 一个字节都没写，也没有快照——它根本没走到那一步。
    expect(await readFile(path.join(workspace, '正文.md'), 'utf8')).toBe('第一章\n');
    await expect(stat(path.join(cacheRoot, toWorkspaceSessionDirName(workspace)))).rejects.toThrow();
  });
  it('没绑定就不动远端，也不下载任何东西', async () => {
    const { instance, downloads, put } = await createSyncService({ dir, workspace, cacheRoot, bound: false });

    await writeTree(workspace, { 'chaptale.json': manifest(WORKSPACE_ID), '正文.md': '第一章\n' });
    await seedArchive(put, { '正文.md': '归档版\n' });

    const result = await instance.applyRestore({ archiveId: 'archive.zip', mode: 'overwrite' });

    expect(result.ok ? '' : result.code).toBe('no-binding');
    expect(downloads).toEqual([]);
  });
});

describe('原地覆盖', () => {
  it('目录链接不能让覆盖恢复写到作品之外', async () => {
    const { instance, put } = await createSyncService({ dir, workspace, cacheRoot });
    const outside = path.join(dir, 'outside');
    await writeTree(workspace, { 'chaptale.json': manifest(WORKSPACE_ID), '正文.md': '本地版本\n' });
    await writeTree(outside, { '秘密.md': '外部原文\n' });
    await symlink(outside, path.join(workspace, '链接'), process.platform === 'win32' ? 'junction' : 'dir');
    await seedArchive(put, { '正文.md': '归档版本\n', '链接/秘密.md': '归档内容\n' });

    const result = await instance.applyRestore({ archiveId: 'archive.zip', mode: 'overwrite' });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('符号链接目标越界');
    expect(await readFile(path.join(workspace, '正文.md'), 'utf8')).toBe('本地版本\n');
    expect(await readFile(path.join(outside, '秘密.md'), 'utf8')).toBe('外部原文\n');
  });

  it('只写归档里有的文件，本地独有的保留', async () => {
    const { instance, put } = await createSyncService({ dir, workspace, cacheRoot });

    await writeTree(workspace, {
      'chaptale.json': manifest(WORKSPACE_ID),
      '正文.md': '新写的第二章\n',
      '番外.md': '只在本地\n',
      '灵感/空着/占位.md': ''
    });
    await seedArchive(put, { '正文.md': '第一章\n', '草稿/一稿.md': '一稿\n' });

    const result = await instance.applyRestore({ archiveId: 'archive.zip', mode: 'overwrite' });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.mode).toBe('overwrite');
    expect(result.targetPath).toBe(workspace);
    expect(result.writtenPaths.toSorted()).toEqual(['chaptale.json', '正文.md', '草稿/一稿.md']);
    // 本地独有的一个都不删：恢复到旧版本不该顺手抹掉新写的章节。
    expect(await readFile(path.join(workspace, '番外.md'), 'utf8')).toBe('只在本地\n');
    expect(await readFile(path.join(workspace, '灵感/空着/占位.md'), 'utf8')).toBe('');
    // 正文被归档版本替换，归档里的新文件落到位。
    expect(await readFile(path.join(workspace, '正文.md'), 'utf8')).toBe('第一章\n');
    expect(await readFile(path.join(workspace, '草稿/一稿.md'), 'utf8')).toBe('一稿\n');
  });
  it('覆盖前先留快照，快照里是覆盖前的内容', async () => {
    const { instance, put } = await createSyncService({ dir, workspace, cacheRoot });

    await writeTree(workspace, { 'chaptale.json': manifest(WORKSPACE_ID), '正文.md': '覆盖前\n' });
    await seedArchive(put, { '正文.md': '归档版\n' });

    const result = await instance.applyRestore({ archiveId: 'archive.zip', mode: 'overwrite' });

    expect(result.ok).toBe(true);

    if (!result.ok || !result.snapshotId) throw new Error('覆盖必须留下快照');

    const restored = path.join(dir, 'from-guard');

    await unpackArchive({ archivePath: guardZip(result.snapshotId), targetPath: restored });

    expect(await readFile(path.join(restored, '正文.md'), 'utf8')).toBe('覆盖前\n');
  });
  it('快照失败就不覆盖，作品目录保持原样', async () => {
    // 缓存位置指向一个普通文件：快照无处可写。
    await writeFile(path.join(dir, 'cache-file'), '');
    const { instance, put } = await createSyncService({
      dir,
      workspace,
      cacheRoot: path.join(dir, 'cache-file')
    });

    await writeTree(workspace, { 'chaptale.json': manifest(WORKSPACE_ID), '正文.md': '覆盖前\n' });
    await seedArchive(put, { '正文.md': '归档版\n' });

    const result = await instance.applyRestore({ archiveId: 'archive.zip', mode: 'overwrite' });

    expect(result.ok).toBe(false);
    expect(await readFile(path.join(workspace, '正文.md'), 'utf8')).toBe('覆盖前\n');
  });
});

describe('合并', () => {
  it('没有决议的冲突项不写也不覆盖，只列进回执', async () => {
    const { instance, put } = await createSyncService({ dir, workspace, cacheRoot });

    await writeTree(workspace, {
      'chaptale.json': manifest(WORKSPACE_ID),
      '正文.md': '本地版本\n',
      '番外.md': '只在本地\n'
    });
    await seedArchive(put, { '正文.md': '归档版本\n', '灵感/片段.md': '片段\n' });

    const result = await instance.applyRestore({ archiveId: 'archive.zip', mode: 'merge' });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    // 新增的不问自取，冲突的等作者点头；作品清单两边一致，不必动。
    expect(result.writtenPaths).toEqual(['灵感/片段.md']);
    expect(result.skipped).toEqual([{ relativePath: '正文.md', reason: '你没对这项做决定，本地保持不动' }]);
    expect(await readFile(path.join(workspace, '正文.md'), 'utf8')).toBe('本地版本\n');
  });
  it('三种决议各走各的路：用归档 / 用本地 / 两个都留', async () => {
    const { instance, put } = await createSyncService({ dir, workspace, cacheRoot });

    await writeTree(workspace, {
      'chaptale.json': manifest(WORKSPACE_ID),
      '正文.md': '本地版本\n',
      '草稿/01.md': '本地一稿\n',
      '草稿/02.md': '本地二稿\n'
    });
    await seedArchive(put, { '正文.md': '归档版本\n', '草稿/01.md': '归档一稿\n', '草稿/02.md': '归档二稿\n' });

    const result = await instance.applyRestore({
      archiveId: 'archive.zip',
      mode: 'merge',
      choices: { '正文.md': 'archive', '草稿/01.md': 'local', '草稿/02.md': 'both' }
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    // 作品清单一字未改，合并不会碰它；只写下有决议的两项。
    expect(result.writtenPaths.toSorted()).toEqual(['正文.md', '草稿/02.md']);
    expect(await readFile(path.join(workspace, '正文.md'), 'utf8')).toBe('归档版本\n');
    expect(await readFile(path.join(workspace, '草稿/01.md'), 'utf8')).toBe('本地一稿\n');
    // 两个都留：原路径让给归档版本，本地那份以冲突副本留档。
    expect(await readFile(path.join(workspace, '草稿/02.md'), 'utf8')).toBe('归档二稿\n');

    const kept = (await readdir(path.join(workspace, '草稿'))).filter(name => name.includes('冲突副本'));

    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^02 \(冲突副本 \d{8}-\d{6}\)\.md$/);
    expect(await readFile(path.join(workspace, '草稿', kept[0] as string), 'utf8')).toBe('本地二稿\n');
  });
});

describe('恢复到新目录', () => {
  it('原作品一个字节都没动，新目录在作品旁边', async () => {
    const { instance, put } = await createSyncService({ dir, workspace, cacheRoot });

    await writeTree(workspace, { 'chaptale.json': manifest(WORKSPACE_ID), '正文.md': '当前版本\n' });
    await seedArchive(put, { '正文.md': '归档版本\n', '灵感/片段.md': '片段\n' });

    const result = await instance.applyRestore({ archiveId: 'archive.zip', mode: 'new' });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(path.dirname(result.targetPath)).toBe(dir);
    expect(path.basename(result.targetPath)).toMatch(/^长夜-恢复-\d{8}-\d{6}$/);
    expect(result.snapshotId).toBeNull();
    expect(await readFile(path.join(result.targetPath, '正文.md'), 'utf8')).toBe('归档版本\n');
    expect(await readFile(path.join(workspace, '正文.md'), 'utf8')).toBe('当前版本\n');
  });
});

describe('恢复的临时归档', () => {
  it('计划与执行共用同一份下载，取消后不留副本', async () => {
    const { instance, downloads, put } = await createSyncService({ dir, workspace, cacheRoot });

    await writeTree(workspace, { 'chaptale.json': manifest(WORKSPACE_ID), '正文.md': '本地\n' });
    await seedArchive(put, { '正文.md': '归档\n' });

    await instance.planRestore({ archiveId: 'archive.zip' });
    await instance.applyRestore({ archiveId: 'archive.zip', mode: 'overwrite' });

    expect(downloads).toEqual(['archive.zip']);

    await instance.planRestore({ archiveId: 'archive.zip' });
    await instance.cancelRestore();

    await expect(stat(path.join(cacheRoot, 'cloud-restore'))).rejects.toThrow();
  });
});
