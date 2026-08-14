import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../../../core/frontmatter/parse';
import { MemoryPendingStore } from '../pending-store';
import { createMemoryProposeTool, createMemorySaveTool } from '../tools';

describe('memory tools', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-memtool-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('memory_save writes a note with frontmatter and session source', async () => {
    const tool = createMemorySaveTool({ resolveCwd: () => cwd, getSessionId: () => 's-9' });

    const result = await tool.execute({
      title: '观察：林晚似乎怕水',
      content: '第 2 章渡河时反应异常。',
      relatedTo: ['[[林晚]]']
    });

    expect(result.text).toContain('.chaptale/memory/notes/');

    const notesDir = path.join(cwd, '.chaptale', 'memory', 'notes');
    const [fileName] = await fs.readdir(notesDir);
    const raw = await fs.readFile(path.join(notesDir, fileName), 'utf8');

    expect(raw).toContain('kind: note');
    expect(raw).toContain('source: "session:s-9"');
    expect(raw).toContain('[[林晚]]');
    expect(raw).toContain('第 2 章渡河时反应异常。');
  });

  it('memory_save sanitizes titles and never overwrites an existing note', async () => {
    const tool = createMemorySaveTool({ resolveCwd: () => cwd, getSessionId: () => 's-9' });

    // 标题里的路径片段被净化，写入不逃出 notes 目录。
    await tool.execute({ title: '../..\\逃逸: 尝试?', content: '第一条' });
    await tool.execute({ title: '../..\\逃逸: 尝试?', content: '第二条' });

    const notesDir = path.join(cwd, '.chaptale', 'memory', 'notes');
    const files = (await fs.readdir(notesDir)).toSorted();
    expect(files).toHaveLength(2);

    for (const name of files) {
      expect(name).not.toContain('..');
      expect(name.endsWith('.md')).toBe(true);
    }
  });

  it('memory_save refuses to run before the session is ready', async () => {
    const tool = createMemorySaveTool({ resolveCwd: () => cwd, getSessionId: () => null });

    await expect(tool.execute({ title: 't', content: 'c' })).rejects.toThrow('会话尚未就绪');
  });

  it('memory_propose submits a pending proposal instead of touching the target', async () => {
    const pendingStore = new MemoryPendingStore({ parseFrontmatter });
    const tool = createMemoryProposeTool({ resolveCwd: () => cwd, getSessionId: () => 's-9', pendingStore });

    const result = await tool.execute({
      proposalType: 'create',
      title: '新增角色：沈青',
      reason: '第 3 章出场',
      targetPath: '角色/沈青.md',
      content: '---\nkind: character\n---\n\n沈青。\n'
    });

    // 提议只落 pending，目标文件不产生。
    expect(result.text).toContain('等待作者');
    await expect(fs.access(path.join(cwd, '角色', '沈青.md'))).rejects.toThrow();
    expect((await pendingStore.list(cwd)).proposals).toHaveLength(1);
  });

  it('memory_propose requires content for create and update proposals', async () => {
    const pendingStore = new MemoryPendingStore({ parseFrontmatter });
    const tool = createMemoryProposeTool({ resolveCwd: () => cwd, getSessionId: () => 's-9', pendingStore });

    await expect(
      tool.execute({ proposalType: 'create', title: 't', reason: 'r', targetPath: '角色/x.md' })
    ).rejects.toThrow('完整的新文件内容');
  });
});
