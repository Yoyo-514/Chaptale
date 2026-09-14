import { unzipSync, zipSync } from 'fflate';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { packWorkspace, resolveInside, unpackArchive } from '../archive';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-archive-'));
});
afterEach(async () => {
  expect(path.dirname(path.resolve(dir))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(dir)).toMatch(/^chaptale-archive-/);
  await rm(dir, { recursive: true, force: true });
});

async function seedWorkspace() {
  const workspace = path.join(dir, 'work');

  await mkdir(path.join(workspace, '.chaptale', 'memory'), { recursive: true });
  await writeFile(path.join(workspace, '正文.md'), '# 一\n\n正文内容。\n');
  await writeFile(path.join(workspace, '.chaptale', 'memory', 'notes.md'), '笔记');

  return workspace;
}

describe('作品归档', () => {
  it('打包整棵目录树后可原样解出，含应用数据目录', async () => {
    const workspace = await seedWorkspace();
    const archivePath = path.join(dir, 'out.zip');
    const packed = await packWorkspace({ rootPath: workspace, targetPath: archivePath });

    expect(packed.files).toBe(2);
    expect(packed.bytes).toBeGreaterThan(0);

    const target = path.join(dir, 'restored');
    const unpacked = await unpackArchive({ archivePath, targetPath: target });

    expect(unpacked.files).toBe(2);
    expect(await readFile(path.join(target, '正文.md'), 'utf8')).toBe('# 一\n\n正文内容。\n');
    expect(await readFile(path.join(target, '.chaptale', 'memory', 'notes.md'), 'utf8')).toBe('笔记');
  });
  it('跳过系统垃圾文件与符号链接，不把作品之外的内容卷进归档', async () => {
    const workspace = await seedWorkspace();
    const outside = path.join(dir, 'outside');

    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.md'), '外部内容');
    await writeFile(path.join(workspace, '.DS_Store'), 'junk');
    await symlink(outside, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    const packed = await packWorkspace({ rootPath: workspace, targetPath: path.join(dir, 'out.zip') });

    expect(packed.files).toBe(2);

    const target = path.join(dir, 'restored');

    await unpackArchive({ archivePath: path.join(dir, 'out.zip'), targetPath: target });
    await expect(readFile(path.join(target, 'linked', 'secret.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(target, '.DS_Store'), 'utf8')).rejects.toThrow();
  });
  it('空目录自带条目：恢复后目录结构完整，不往作品里塞占位文件', async () => {
    const workspace = await seedWorkspace();

    await mkdir(path.join(workspace, '灵感'));
    await mkdir(path.join(workspace, '草稿', '旧'), { recursive: true });

    const archivePath = path.join(dir, 'out.zip');
    const packed = await packWorkspace({ rootPath: workspace, targetPath: archivePath });

    // 目录不计入文件数：回执里说的“N 个文件”就是真的文件数。
    expect(packed.files).toBe(2);

    const target = path.join(dir, 'restored');
    const unpacked = await unpackArchive({ archivePath, targetPath: target });

    expect(unpacked.files).toBe(2);
    expect(await readdir(path.join(target, '灵感'))).toEqual([]);
    expect(await readdir(path.join(target, '草稿'))).toEqual(['旧']);
    expect(await readdir(path.join(target, '草稿', '旧'))).toEqual([]);
  });
  it('只给空目录写条目：装得下东西的目录靠文件路径就能建出来', async () => {
    const workspace = await seedWorkspace();
    const archivePath = path.join(dir, 'out.zip');

    await mkdir(path.join(workspace, '灵感'));
    await packWorkspace({ rootPath: workspace, targetPath: archivePath });

    const names = Object.keys(unzipSync(new Uint8Array(await readFile(archivePath))));

    expect(names).toContain('灵感/');
    expect(names).not.toContain('.chaptale/');
    expect(names).not.toContain('.chaptale/memory/');
  });
  it('按文件数回报进度，总数在开始时就已经确定', async () => {
    const workspace = await seedWorkspace();
    const seen: string[] = [];

    await packWorkspace({
      rootPath: workspace,
      targetPath: path.join(dir, 'out.zip'),
      onProgress: (done, total) => seen.push(`${done}/${total}`)
    });

    expect(seen).toEqual(['1/2', '2/2']);
  });
  it('取消后不再产生归档文件', async () => {
    const workspace = await seedWorkspace();
    const controller = new AbortController();

    controller.abort();

    await expect(
      packWorkspace({ rootPath: workspace, targetPath: path.join(dir, 'out.zip'), signal: controller.signal })
    ).rejects.toThrow('已取消');
  });
  it('条目名越出目标目录时拒绝解包', () => {
    const root = path.join(dir, 'target');

    expect(resolveInside(root, 'a/b.md')).toBe(path.join(root, 'a', 'b.md'));
    expect(() => resolveInside(root, '/abs.md')).toThrow('归档条目');
    expect(() => resolveInside(root, '../escape.md')).toThrow('越出目标目录');
    expect(() => resolveInside(root, 'a/../../escape.md')).toThrow('越出目标目录');
  });

  it('归档包含非法条目时，在任何正文写入前拒绝整包', async () => {
    const target = await seedWorkspace();
    const archivePath = path.join(dir, 'malicious.zip');
    await writeFile(
      archivePath,
      zipSync({
        '正文.md': new TextEncoder().encode('不应覆盖'),
        '../escape.md': new TextEncoder().encode('不应写入')
      })
    );

    await expect(unpackArchive({ archivePath, targetPath: target })).rejects.toThrow('归档条目');
    expect(await readFile(path.join(target, '正文.md'), 'utf8')).toBe('# 一\n\n正文内容。\n');
    await expect(readFile(path.join(dir, 'escape.md'))).rejects.toThrow();
  });

  it('恢复目标含目录链接时，不沿链接覆盖作品外的文件', async () => {
    const workspace = await seedWorkspace();
    const outside = path.join(dir, 'outside');
    const archivePath = path.join(dir, 'linked.zip');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.md'), '外部原文');
    await symlink(outside, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(archivePath, zipSync({ 'linked/secret.md': new TextEncoder().encode('归档原文') }));

    await expect(unpackArchive({ archivePath, targetPath: workspace })).rejects.toThrow('符号链接目标越界');
    expect(await readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('外部原文');
  });

  it.each(['C:/outside.md', 'file.md:stream', 'a\\..\\outside.md', './draft.md'])(
    '拒绝不规范或 Windows 特殊路径 %s',
    entry => {
      expect(() => resolveInside(path.join(dir, 'target'), entry)).toThrow('归档条目');
    }
  );
});
