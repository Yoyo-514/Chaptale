import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../../../core/frontmatter/parse';
import { createEditTool } from '../../file-tools/tools';
import { MemoryPendingStore } from '../../memory/pending/store';
import { WorkspaceService } from '../service';

let root: string;
let workspace: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-shared-writes-'));
  workspace = path.join(root, 'book');
  await mkdir(workspace);
});
afterEach(async () => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root).startsWith('chaptale-shared-writes-')).toBe(true);
  await rm(root, { recursive: true, force: true });
});
describe('应用共享写入队列', () => {
  it('并发的精确编辑都保留，编辑器旧基线拒绝覆盖', async () => {
    await writeFile(path.join(workspace, 'a.md'), '甲旧\n乙旧');
    const edit = createEditTool(workspace);
    await Promise.all([
      edit.execute({ path: 'a.md', oldText: '甲旧', newText: '甲新' }),
      edit.execute({ path: 'a.md', oldText: '乙旧', newText: '乙新' })
    ]);
    expect(await readFile(path.join(workspace, 'a.md'), 'utf8')).toBe('甲新\n乙新');
    const service = new WorkspaceService({
      getStorageContext: async () => ({ workspacePath: workspace })
    });
    expect(
      await service.writeDocument({
        rootPath: workspace,
        relativePath: 'a.md',
        expectedHash: createHash('sha256').update('甲旧\n乙旧').digest('hex'),
        content: '过期编辑器'
      })
    ).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('同基线的两个提议最多接受一个，重复处理同一提议不重放', async () => {
    await writeFile(path.join(workspace, 'a.md'), '基线');
    const store = new MemoryPendingStore({ parseFrontmatter });
    const common = {
      proposalType: 'update' as const,
      title: '更新',
      targetPath: 'a.md',
      reason: '作者确认',
      source: 'run:test'
    };
    const a = await store.add(workspace, { ...common, content: '甲' });
    const b = await store.add(workspace, { ...common, content: '乙' });
    const results = await Promise.all([
      store.resolve(workspace, a.id, 'accept'),
      store.resolve(workspace, b.id, 'accept')
    ]);
    expect(results.map(result => result.status).toSorted()).toEqual(['applied', 'conflict']);
    const applied = results.find(result => result.status === 'applied')!;
    expect(await store.resolve(workspace, applied.id, 'accept')).toMatchObject({ status: 'missing' });
  });

  it('提议不能通过链接写作品外或应用内部目录', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await mkdir(path.join(workspace, '.chaptale'));
    await symlink(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(
      path.join(workspace, '.chaptale'),
      path.join(workspace, 'internal'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const store = new MemoryPendingStore({ parseFrontmatter });
    for (const targetPath of ['escape/new.md', 'internal/new.md', '.CHAPTALE/new.md', '../outside/new.md']) {
      await expect(
        store.add(workspace, {
          proposalType: 'create',
          title: '越界',
          reason: '拒绝',
          source: 'run:test',
          targetPath,
          content: '不可写入'
        })
      ).rejects.toThrow('目标路径不合法');
    }
  });
});
