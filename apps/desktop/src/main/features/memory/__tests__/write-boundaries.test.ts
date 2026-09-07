import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../../../core/frontmatter/parse';
import { createFileTools } from '../../file-tools/tools';
import { renderProposalFile, setFrontmatterStatusArchived } from '../pending/proposal-file';
import { MemoryPendingStore } from '../pending/store';
import { createMemorySaveTool } from '../tools';

let cwd: string;
let pending: MemoryPendingStore;
const draft = {
  proposalType: 'create' as const,
  title: '提议',
  reason: '理由',
  source: 'session:one',
  content: '新内容'
};
beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'chaptale-write-boundaries-'));
  pending = new MemoryPendingStore({ parseFrontmatter });
});
afterEach(async () => {
  expect(path.dirname(path.resolve(cwd))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(cwd).startsWith('chaptale-write-boundaries-')).toBe(true);
  await rm(cwd, { recursive: true, force: true });
});
describe('创作写入边界', () => {
  it('旧提议缺少基线只能拒绝，不能覆盖文件', async () => {
    await writeFile(path.join(cwd, '角色.md'), '原文\n');
    const proposal = await pending.add(cwd, { ...draft, proposalType: 'update', targetPath: '角色.md' });
    await writeFile(
      path.join(cwd, `.chaptale/memory/pending/${proposal.id}.md`),
      renderProposalFile({ ...proposal, contentHash: undefined })
    );
    expect((await pending.inspect(cwd, proposal.id)).conflict).toBeTruthy();
    expect(await pending.resolve(cwd, proposal.id, 'accept')).toMatchObject({ status: 'conflict' });
    expect(await readFile(path.join(cwd, '角色.md'), 'utf8')).toBe('原文\n');
    expect(await pending.resolve(cwd, proposal.id, 'reject')).toMatchObject({ status: 'rejected' });
  });
  it('正文目录、自定义目录和目录外的章节身份都必须经过候选', async () => {
    await expect(pending.add(cwd, { ...draft, targetPath: '正文/一.md' })).rejects.toThrow('候选');
    await writeFile(path.join(cwd, 'chaptale.json'), JSON.stringify({ dirs: { manuscript: '作品/章节' } }));
    await expect(pending.add(cwd, { ...draft, targetPath: '作品/章节/一.md' })).rejects.toThrow('候选');
    await expect(
      pending.add(cwd, { ...draft, targetPath: '散落.md', content: '---\nkind: chapter\n---\n正文' })
    ).rejects.toThrow('候选');
    await writeFile(path.join(cwd, '散落.md'), '---\nkind: chapter\n---\n正文');
    await expect(pending.add(cwd, { ...draft, targetPath: '散落.md', proposalType: 'archive' })).rejects.toThrow(
      '候选'
    );
  });
  it('历史提议接受时重新检查角色映射，内部文件不能伪装为资产', async () => {
    const proposal = await pending.add(cwd, { ...draft, targetPath: '新章节/一.md' });
    await writeFile(path.join(cwd, 'chaptale.json'), JSON.stringify({ dirs: { manuscript: '新章节' } }));
    expect(await pending.resolve(cwd, proposal.id, 'accept')).toMatchObject({ status: 'conflict' });
    await expect(readFile(path.join(cwd, '新章节/一.md'))).rejects.toThrow();
    for (const targetPath of ['.git/config.md', '.chaptale/伪造.md', 'chaptale.json', 'a/../正文.md']) {
      await expect(pending.add(cwd, { ...draft, targetPath })).rejects.toThrow('目标路径不合法');
    }
  });
  it('记忆目录不能经链接写入作者目录，并发同名笔记不覆盖', async () => {
    const tool = createMemorySaveTool({ resolveCwd: () => cwd, getSessionId: () => 'one' });
    await Promise.all([tool.execute({ title: '观察', content: '甲' }), tool.execute({ title: '观察', content: '乙' })]);
    const notes = path.join(cwd, '.chaptale/memory/notes');
    const names = await readdir(notes);
    expect(names).toHaveLength(2);
    expect((await Promise.all(names.map(name => readFile(path.join(notes, name), 'utf8')))).join('')).toContain('乙');
    await mkdir(path.join(cwd, '作者目录'));
    await symlink(
      path.join(cwd, '作者目录'),
      path.join(cwd, '.chaptale/memory/pending'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(pending.add(cwd, { ...draft, targetPath: '角色.md' })).rejects.toThrow('符号链接');
    expect((await pending.list(cwd)).diagnostics).toHaveLength(1);
    expect(await readdir(path.join(cwd, '作者目录'))).toEqual([]);
  });
  it('通用 Agent 文件工具只写草稿且拒绝章节身份和重叠目录', async () => {
    const tools = createFileTools(cwd);
    const write = tools.find(tool => tool.name === 'write')!;
    const edit = tools.find(tool => tool.name === 'edit')!;
    for (const target of ['正文/一.md', '角色/甲.md', '.chaptale/reviews/one.json', '散落.md']) {
      await expect(write.execute({ path: target, content: '不会写入' })).rejects.toThrow();
    }
    await write.execute({ path: '草稿/候选片段.md', content: '旧片段' });
    await edit.execute({ path: '草稿/候选片段.md', oldText: '旧', newText: '新' });
    expect(await readFile(path.join(cwd, '草稿/候选片段.md'), 'utf8')).toBe('新片段');
    await expect(write.execute({ path: '草稿/一.md', content: '---\nkind: chapter\n---\n正文' })).rejects.toThrow(
      '章节'
    );
    await writeFile(path.join(cwd, 'chaptale.json'), JSON.stringify({ dirs: { drafts: '正文' } }));
    await expect(write.execute({ path: '正文/一.md', content: '不会写入' })).rejects.toThrow('候选');
  });
  it('归档保留 BOM、混合换行和未知字段，坏 YAML 不自动修复', () => {
    const text = '\uFEFF---\r\nkind: character\r\ncustom: [one, two]\r\nstatus: active\r\n---\r\n正文\n';
    expect(setFrontmatterStatusArchived(text)).toBe(text.replace('status: active', 'status: archived'));
    expect(() => setFrontmatterStatusArchived('---\nstatus: [broken\n---\n正文')).toThrow('元数据');
  });
});
