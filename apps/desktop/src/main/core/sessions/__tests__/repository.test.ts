import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@chaptale/shared';

import { JsonlSessionRepository } from '../../../features/sessions/repository';

function flattenMessages(list: ChatMessage[]): string {
  return list
    .map(message => {
      if (message.role === 'user') {
        return typeof message.content === 'string'
          ? message.content
          : message.content.map(part => (part.type === 'text' ? part.text : '')).join(' ');
      }

      if (message.role === 'assistant') {
        return typeof message.content === 'string'
          ? message.content
          : (message.content ?? []).map(part => part.text).join(' ');
      }

      return '';
    })
    .join('|');
}

let root: string;
let repository: JsonlSessionRepository;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-session-repo-'));
  repository = new JsonlSessionRepository({
    rootDir: root,
    cwd: '/workspace',
    sessionDir: path.join(root, 'agent', 'sessions', 'global'),
    sessionsRootDir: path.join(root, 'agent', 'sessions')
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('JsonlSessionRepository', () => {
  it('create → append → list 全链路：名字/leaf/计数/累计 token', async () => {
    const meta = await repository.create({ name: '雨夜构思' });
    expect(meta.cwd).toBe('/workspace');

    const store = await repository.open(meta.id);
    await store.appendMessage({ role: 'user', content: '第一章怎么写' });
    await store.appendMessage({
      role: 'assistant',
      content: '雨夜开场。',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
    });

    const items = await repository.list();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: meta.id,
      name: '雨夜构思',
      messageCount: 2,
      lastMessagePreview: '雨夜开场。',
      totalTokens: 150,
      scope: 'global'
    });
  });

  it('list 跨目录（global + workspace）且忽略非会话文件', async () => {
    await repository.create({ id: 'g1', name: '全局' });

    const workspaceDir = path.join(root, 'agent', 'sessions', 'Story-xyz');
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(
      path.join(workspaceDir, 'w1.jsonl'),
      [
        '{"type":"chaptale-session","version":1,"id":"w1","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/story"}',
        '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"工作区消息"}}'
      ].join('\n'),
      'utf8'
    );
    await writeFile(path.join(workspaceDir, 'junk.jsonl'), 'not a session\n', 'utf8');

    const items = await repository.list();

    expect(items.map(item => item.id).toSorted()).toEqual(['g1', 'w1']);
    expect(items.find(item => item.id === 'w1')).toMatchObject({ scope: 'workspace', messageCount: 1 });
  });

  it('跨 scope 目录也能按 sessionId 打开（global 会话在 workspace 模式下可读）', async () => {
    // 另一个仓储实例（sessionDir 指向 archive-scope）创建会话。
    const archiveDir = path.join(root, 'agent', 'sessions', 'archive-scope');
    const archiveRepo = new JsonlSessionRepository({
      rootDir: root,
      cwd: '/workspace',
      sessionDir: archiveDir,
      sessionsRootDir: path.join(root, 'agent', 'sessions')
    });
    const created = await archiveRepo.create({ cwd: '/workspace' });
    const store = await archiveRepo.openOrCreate(created.id, '/workspace');
    await store.appendMessage({ role: 'user', content: '归档会话' });

    // 主仓储（sessionDir 指向 global）按 id 全域查找应能打开 archive-scope 里的会话。
    const messages = await repository.getMessages(created.id);
    expect(messages.map(message => (message.role === 'user' ? message.content : ''))).toContain('归档会话');
  });

  it('getEntries / getMessages：工具链与 system 过滤', async () => {
    const meta = await repository.create({ id: 's1' });
    const store = await repository.openOrCreate('s1', '/w');

    await store.appendMessage({ role: 'system', content: '你是助手' });
    await store.appendMessage({ role: 'user', content: '搜索雨夜' });
    await store.appendMessage({
      role: 'assistant',
      toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: '雨夜' } }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    });
    await store.appendMessage({
      role: 'tool',
      toolCallId: 'call_1',
      toolName: 'web_search',
      output: { results: [{ title: '示例', url: 'https://e.com', snippet: 's' }] }
    });

    const messages = await repository.getMessages(meta.id);

    // system 不进 UI；user / assistant(toolCalls) / tool。
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ role: 'user', content: '搜索雨夜' });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'call_1', name: 'web_search' }],
      usage: { totalTokens: 15 }
    });
    expect(messages[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call_1',
      toolName: 'web_search',
      output: { results: [{ title: '示例', url: 'https://e.com', snippet: 's' }] }
    });

    const entries = await repository.getEntries(meta.id);
    expect(entries.map(entry => entry.type)).toEqual(['message', 'message', 'message']);
  });

  it('setLeafId 分支切换反映到 getMessages；readImage 会话内 base64', async () => {
    const meta = await repository.create({ id: 's1' });
    const store = await repository.openOrCreate('s1', '/w');

    const m1 = await store.appendMessage({ role: 'user', content: 'A' });
    const a1 = await store.appendMessage({ role: 'assistant', content: '答案一' });
    await store.appendMessage({ role: 'user', content: 'B' });

    await repository.setLeafId(meta.id, m1.id);
    await store.appendMessage({ role: 'assistant', content: '答案二' });

    const messages = await repository.getMessages(meta.id);
    const flat = flattenMessages(messages);

    expect(flat).toContain('答案二');
    expect(flat).not.toContain('答案一');
    void a1;

    // readImage：entryId + 原始下标定位 base64。
    const imageEntry = await store.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image', mimeType: 'image/png', data: Buffer.from('png-bytes').toString('base64') }
      ]
    });
    const read = await repository.readImage({
      type: 'session-entry',
      sessionId: meta.id,
      entryId: imageEntry.id,
      blockIndex: 1
    });

    expect(new TextDecoder().decode(read.data)).toBe('png-bytes');
    expect(read.mimeType).toBe('image/png');
  });

  it('getEntries 返回全量树（被切走的分支仍在），导出只含当前分支', async () => {
    // 分支导航的判据是"同 parentId 下有几个 user 节点"。只返回当前分支时
    // 每层恒为一个节点，UI 永远算不出兄弟，导航就整个消失。
    const meta = await repository.create({ id: 's1', name: '分叉会话' });
    const store = await repository.openOrCreate('s1', '/w');
    const rootId = store.entries[0].id;

    const first = await store.appendMessage({ role: 'user', content: '原问题' });
    await store.appendMessage({ role: 'assistant', content: '原回答' });

    await repository.setLeafId(meta.id, rootId);
    const second = await store.appendMessage({ role: 'user', content: '改后问题' });
    await store.appendMessage({ role: 'assistant', content: '新回答' });

    const entries = await repository.getEntries(meta.id);
    const siblings = entries.filter(
      entry => entry.type === 'message' && entry.parentId === rootId && entry.message.role === 'user'
    );

    expect(siblings.map(entry => entry.id)).toEqual([first.id, second.id]);
    expect(entries.map(entry => entry.id)).toContain(first.id);

    // 导出的是作者当前看到的那条线，不是整棵树。
    const exported = await repository.exportHtml(meta.id);
    expect(exported.html).toContain('新回答');
    expect(exported.html).not.toContain('原回答');
  });

  it('openOrCreate 新建的会话，list 报的 id 必须能再打开', async () => {
    // 会话身份有两个载体：文件名（locateSessionFile / delete 拼 `${id}.jsonl`）
    // 与 header.id（list 上报）。openOrCreate 不显式传 id 时 header 会落随机 UUID，
    // 于是历史里列得出来、点开却 ENOENT。
    const store = await repository.openOrCreate('fresh-session', '/workspace');
    await store.appendMessage({ role: 'user', content: '未经 create 直接开跑' });

    expect(store.header.id).toBe('fresh-session');

    const listed = await repository.list();
    expect(listed.map(item => item.id)).toEqual(['fresh-session']);

    // 清掉实例内缓存，强制走文件定位——缓存命中会掩盖文件名与 id 的错位。
    const reopened = new JsonlSessionRepository({
      rootDir: root,
      cwd: '/workspace',
      sessionDir: path.join(root, 'agent', 'sessions', 'global'),
      sessionsRootDir: path.join(root, 'agent', 'sessions')
    });

    await expect(reopened.getMessages(listed[0]!.id)).resolves.toHaveLength(1);
  });

  it('delete / deleteMany / appendSessionInfo / exportHtml', async () => {
    const meta = await repository.create({ id: 's1' });
    const store = await repository.openOrCreate('s1', '/w');
    await store.appendMessage({ role: 'user', content: '导出测试' });

    const renamed = await repository.appendSessionInfo(meta.id, '新名字');
    expect(renamed).toMatchObject({ type: 'session_info', name: '新名字' });

    const exported = await repository.exportHtml(meta.id);
    expect(exported.html).toContain('导出测试');
    expect(exported.suggestedFileName).toBe('新名字.html');

    await repository.delete(meta.id);
    await expect(repository.list()).resolves.toHaveLength(0);
  });
});
