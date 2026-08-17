import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseFrontmatter } from '../../../../core/frontmatter/parse';
import { hashContent, setFrontmatterStatusArchived } from '../proposal-file';
import { MemoryPendingStore } from '../store';

describe('MemoryPendingStore', () => {
  let cwd: string;
  let store: MemoryPendingStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-pending-'));
    store = new MemoryPendingStore({ parseFrontmatter });
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('keeps proposals isolated by the explicit workspace cwd', async () => {
    const workspaceA = path.join(cwd, 'workspace-a');
    const workspaceB = path.join(cwd, 'workspace-b');
    await fs.mkdir(workspaceA, { recursive: true });
    await fs.mkdir(workspaceB, { recursive: true });

    const proposal = await store.add(workspaceA, {
      proposalType: 'create',
      title: '新增角色：沈青',
      reason: '只属于 A 工作区',
      targetPath: '角色/沈青.md',
      source: 'session:s-1',
      content: '---\nkind: character\ntitle: 沈青\n---\n\n沈青只在 A。\n'
    });

    expect((await store.list(workspaceA)).proposals).toHaveLength(1);
    expect((await store.list(workspaceB)).proposals).toHaveLength(0);

    const result = await store.resolve(workspaceA, proposal.id, 'accept');
    expect(result.status).toBe('applied');

    await expect(fs.readFile(path.join(workspaceA, '角色', '沈青.md'), 'utf8')).resolves.toContain('沈青只在 A');
    await expect(fs.access(path.join(workspaceB, '角色', '沈青.md'))).rejects.toThrow();
    expect((await store.list(workspaceA)).proposals).toHaveLength(0);
    expect((await store.list(workspaceB)).proposals).toHaveLength(0);
  });

  it('adds a create proposal, lists it and applies it on accept', async () => {
    const listener = vi.fn();
    store.onChange(listener);

    const proposal = await store.add(cwd, {
      proposalType: 'create',
      title: '新增角色：沈青',
      reason: '第 3 章出场的新配角',
      targetPath: '角色/沈青.md',
      source: 'session:s-1',
      content: '---\nkind: character\ntitle: 沈青\n---\n\n沈青是茶馆老板。\n'
    });

    expect(listener).toHaveBeenCalledTimes(1);

    const listed = await store.list(cwd);
    expect(listed.proposals).toHaveLength(1);
    expect(listed.proposals[0]).toMatchObject({ id: proposal.id, proposalType: 'create', targetPath: '角色/沈青.md' });

    const result = await store.resolve(cwd, proposal.id, 'accept');
    expect(result.status).toBe('applied');

    const written = await fs.readFile(path.join(cwd, '角色', '沈青.md'), 'utf8');
    expect(written).toContain('沈青是茶馆老板');

    // 终态提议归档留痕，pending 列表清空。
    expect((await store.list(cwd)).proposals).toHaveLength(0);
    const archived = await fs.readdir(path.join(cwd, '.chaptale', 'memory', 'pending', 'archived'));
    expect(archived).toEqual([`${proposal.id}.md`]);
  });

  it('applies update only when contentHash still matches, otherwise reports conflict', async () => {
    const target = path.join(cwd, '设定', '世界观.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '旧版本内容\n', 'utf8');

    const proposal = await store.add(cwd, {
      proposalType: 'update',
      title: '更新世界观',
      reason: '补充灵力体系',
      targetPath: '设定/世界观.md',
      source: 'session:s-1',
      content: '新版本内容\n'
    });

    expect(proposal.contentHash).toBe(hashContent('旧版本内容\n'));

    // 作者在确认前改了文件：接受必须失败为 conflict，且提议保留。
    await fs.writeFile(target, '作者手改的内容\n', 'utf8');
    const conflict = await store.resolve(cwd, proposal.id, 'accept');
    expect(conflict.status).toBe('conflict');
    expect((await store.list(cwd)).proposals).toHaveLength(1);
    expect(await fs.readFile(target, 'utf8')).toBe('作者手改的内容\n');

    // 恢复原内容后接受成功。
    await fs.writeFile(target, '旧版本内容\n', 'utf8');
    const applied = await store.resolve(cwd, proposal.id, 'accept');
    expect(applied.status).toBe('applied');
    expect(await fs.readFile(target, 'utf8')).toBe('新版本内容\n');
  });

  it('archives target by rewriting frontmatter status and keeps file content intact', async () => {
    const target = path.join(cwd, '角色', '林晚.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '---\nkind: character\ntitle: 林晚\nstatus: active\n---\n\n正文不变。\n', 'utf8');

    const proposal = await store.add(cwd, {
      proposalType: 'archive',
      title: '归档林晚',
      reason: '角色已退场',
      targetPath: '角色/林晚.md',
      source: 'session:s-1'
    });

    const result = await store.resolve(cwd, proposal.id, 'accept');
    expect(result.status).toBe('applied');

    const archived = await fs.readFile(target, 'utf8');
    expect(archived).toContain('status: archived');
    expect(archived).toContain('正文不变。');
    expect(archived).toContain('title: 林晚');
  });

  it('rejects proposals targeting outside the workspace or inside .chaptale', async () => {
    await expect(
      store.add(cwd, {
        proposalType: 'create',
        title: 't',
        reason: 'r',
        targetPath: '../外部.md',
        source: 's',
        content: 'x'
      })
    ).rejects.toThrow('目标路径不合法');

    await expect(
      store.add(cwd, {
        proposalType: 'create',
        title: 't',
        reason: 'r',
        targetPath: '.chaptale/permissions.json',
        source: 's',
        content: 'x'
      })
    ).rejects.toThrow('目标路径不合法');
  });

  it('rejecting a proposal archives it without touching the target', async () => {
    const target = path.join(cwd, '设定', '守则.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '原内容\n', 'utf8');

    const proposal = await store.add(cwd, {
      proposalType: 'update',
      title: '改守则',
      reason: '理由',
      targetPath: '设定/守则.md',
      source: 'session:s-1',
      content: '新内容\n'
    });

    const result = await store.resolve(cwd, proposal.id, 'reject');
    expect(result.status).toBe('rejected');
    expect(await fs.readFile(target, 'utf8')).toBe('原内容\n');
    expect((await store.list(cwd)).proposals).toHaveLength(0);
  });

  it('refuses update proposals for missing targets and create proposals for occupied paths', async () => {
    await expect(
      store.add(cwd, {
        proposalType: 'update',
        title: 't',
        reason: 'r',
        targetPath: '不存在.md',
        source: 's',
        content: 'x'
      })
    ).rejects.toThrow('目标文件不存在');

    await fs.writeFile(path.join(cwd, '已存在.md'), 'x\n', 'utf8');
    await expect(
      store.add(cwd, {
        proposalType: 'create',
        title: 't',
        reason: 'r',
        targetPath: '已存在.md',
        source: 's',
        content: 'x'
      })
    ).rejects.toThrow('请改用 update');
  });
});

describe('setFrontmatterStatusArchived', () => {
  it('replaces an existing status line', () => {
    expect(setFrontmatterStatusArchived('---\nstatus: active\ntitle: a\n---\n\n正文')).toBe(
      '---\nstatus: archived\ntitle: a\n---\n\n正文'
    );
  });

  it('appends status into an existing frontmatter block', () => {
    expect(setFrontmatterStatusArchived('---\ntitle: a\n---\n\n正文')).toBe(
      '---\ntitle: a\nstatus: archived\n---\n\n正文'
    );
  });

  it('creates a frontmatter block when none exists', () => {
    expect(setFrontmatterStatusArchived('纯正文')).toBe('---\nstatus: archived\n---\n\n纯正文');
  });
});
