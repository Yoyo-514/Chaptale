import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { packWorkspace } from '../archive';
import { checksum } from '../checksum';
import { readArchiveEntry, readArchiveManifest } from '../manifest';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-manifest-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function packedWorkspace() {
  const workspace = path.join(dir, 'work');
  const archivePath = path.join(dir, 'out.zip');

  await mkdir(path.join(workspace, '灵感'), { recursive: true });
  await mkdir(path.join(workspace, '草稿'), { recursive: true });
  await writeFile(path.join(workspace, '正文.md'), '第一章\n');
  await writeFile(path.join(workspace, '灵感', '片段.md'), '片段。\n');
  await packWorkspace({ rootPath: workspace, targetPath: archivePath });

  return { workspace, archivePath };
}

describe('归档读回', () => {
  it('清单给出文件与指纹，空目录单独列出', async () => {
    const { archivePath } = await packedWorkspace();
    const manifest = await readArchiveManifest(archivePath);

    // 排序按码位：与归档打包侧（`collectWorkspaceContent`）用的是同一种比法，两处顺序一致。
    expect(manifest.files.map(file => file.relativePath)).toEqual(['正文.md', '灵感/片段.md']);
    expect(manifest.files.find(file => file.relativePath === '正文.md')?.digest).toBe(
      checksum(new TextEncoder().encode('第一章\n'))
    );
    // 草稿/ 里没有文件：只有目录条目能保住它。
    expect(manifest.directories).toEqual(['草稿']);
  });
  it('单个条目可以只解自己，取不到就是 null', async () => {
    const { archivePath } = await packedWorkspace();
    const entry = await readArchiveEntry(archivePath, '灵感/片段.md');

    expect(entry && new TextDecoder().decode(entry)).toBe('片段。\n');
    expect(await readArchiveEntry(archivePath, '灵感/没有这个.md')).toBeNull();
  });
  it('读不出来的归档是错误，不是空归档', async () => {
    const broken = path.join(dir, 'broken.zip');

    await writeFile(broken, '这不是一个 zip');

    await expect(readArchiveManifest(broken)).rejects.toThrow();
  });
});
