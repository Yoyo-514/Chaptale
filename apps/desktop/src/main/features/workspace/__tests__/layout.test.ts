import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceLayoutService } from '../../../core/workspace/layout';
import { WorkspaceService } from '../service';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-layout-'));
});
afterEach(async () => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root).startsWith('chaptale-layout-')).toBe(true);
  await rm(root, { recursive: true, force: true });
});

describe('目录角色与章节', () => {
  it('默认名只探测，不偷偷创建文件或目录', async () => {
    const layout = await new WorkspaceLayoutService().read(root);
    expect(layout.roles.manuscript).toEqual({ relativePath: '正文', exists: false });
    expect(await readdir(root)).toEqual([]);
  });

  it('支持已有作品自定义映射，并拒绝穿越或内部目录', async () => {
    await mkdir(path.join(root, 'Chapters'));
    await writeFile(
      path.join(root, 'chaptale.json'),
      JSON.stringify({
        version: 1,
        id: 'book',
        title: '作品',
        kind: 'novel',
        dirs: { manuscript: 'Chapters', world: '../outside', drafts: '.chaptale' }
      })
    );
    const layout = await new WorkspaceLayoutService().read(root);
    expect(layout.roles.manuscript).toEqual({ relativePath: 'Chapters', exists: true });
    expect(layout.roles.world.relativePath).toBe('设定');
    expect(layout.roles.drafts.relativePath).toBe('草稿');
    expect(layout.diagnostics.length).toBeGreaterThan(0);
  });

  it('显式新建章节才建默认目录，稳定 id 和 frontmatter 完整，重名不覆盖', async () => {
    const service = new WorkspaceService({
      getStorageContext: async () => ({ workspacePath: root })
    });
    const args = { rootPath: root, title: '初雪', filename: '0001-初雪.md', order: 1 };
    const result = await service.createChapter(args);
    expect(result).toMatchObject({
      ok: true,
      document: {
        relativePath: '正文/0001-初雪.md',
        head: {
          status: 'ok',
          frontmatter: {
            id: expect.any(String),
            kind: 'chapter',
            title: '初雪',
            order: 1,
            status: 'draft'
          }
        }
      }
    });
    const original = await readFile(path.join(root, '正文/0001-初雪.md'), 'utf8');
    expect(await service.createChapter(args)).toMatchObject({ ok: false, message: '同名章节已存在' });
    expect(await readFile(path.join(root, '正文/0001-初雪.md'), 'utf8')).toBe(original);
    expect(await readdir(path.join(root, '正文'))).toEqual(['0001-初雪.md']);
  });
});
