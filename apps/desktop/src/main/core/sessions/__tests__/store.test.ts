import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionStore } from '../store';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-session-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SessionStore.create / open', () => {
  it('create 写 header，wx 拒绝覆盖既有文件', async () => {
    const filePath = path.join(dir, 'a.jsonl');
    const store = await SessionStore.create(filePath, { cwd: '/w', id: 's1' });

    expect(store.header.id).toBe('s1');
    expect(store.currentLeafId).toBeNull();
    expect(store.entries).toHaveLength(0);

    const raw = await readFile(filePath, 'utf8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(1);

    await expect(SessionStore.create(filePath, { cwd: '/w' })).rejects.toMatchObject({
      code: 'EEXIST'
    });
  });

  it('open 回读 entries 并解析 leaf', async () => {
    const filePath = path.join(dir, 'a.jsonl');
    const created = await SessionStore.create(filePath, { cwd: '/w', id: 's1' });

    await created.appendMessage({ role: 'user', content: 'hi' });
    await created.appendMessage({ role: 'assistant', content: 'hello' });

    const reopened = await SessionStore.open(filePath);

    expect(reopened.entries.map(entry => entry.id)).toEqual(created.entries.map(entry => entry.id));
    expect(reopened.currentLeafId).toBe(created.entries.at(-1)?.id);
  });

  it('openOrCreate：不存在则创建，存在则沿用原 header 打开', async () => {
    const filePath = path.join(dir, 'a.jsonl');

    const first = await SessionStore.openOrCreate(filePath, { cwd: '/w', id: 's1' });
    await first.appendMessage({ role: 'user', content: 'hi' });

    const second = await SessionStore.openOrCreate(filePath, { cwd: '/other', id: 's2' });

    // 已存在 → 原 header 生效（cwd/id 不被新 options 覆盖）。
    expect(second.header.id).toBe('s1');
    expect(second.header.cwd).toBe('/w');
    expect(second.entries).toHaveLength(1);
  });

  it('open 尾行截断文件 → 坏行跳过，其余正常', async () => {
    const filePath = path.join(dir, 'truncated.jsonl');
    await writeFile(
      filePath,
      [
        '{"type":"chaptale-session","version":1,"id":"t1","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}',
        '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"hi"}}',
        '{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-01-01T00:00:0'
      ].join('\n')
    );

    const store = await SessionStore.open(filePath);

    expect(store.entries).toHaveLength(1);
    expect(store.skippedTailLines).toBe(1);
    expect(store.currentLeafId).toBe('m1');
  });
});

describe('append 语义', () => {
  it('appendMessage 追加并前移 leaf；parentId 链接正确', async () => {
    const store = await SessionStore.create(path.join(dir, 'a.jsonl'), { cwd: '/w' });

    const m1 = await store.appendMessage({ role: 'user', content: 'q' });
    const m2 = await store.appendMessage({ role: 'assistant', content: 'a' });

    expect(m1.parentId).toBeNull();
    expect(m2.parentId).toBe(m1.id);
    expect(store.currentLeafId).toBe(m2.id);

    const raw = await readFile(path.join(dir, 'a.jsonl'), 'utf8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('各 append 变体落盘为对应 type', async () => {
    const store = await SessionStore.create(path.join(dir, 'a.jsonl'), { cwd: '/w' });

    await store.appendMessage({ role: 'user', content: 'q' });
    await store.appendModelChange('anthropic', 'claude-sonnet-4');
    await store.appendCompaction('摘要', store.entries[0]!.id, 123, { todo: [] });
    await store.appendSessionInfo('会话名');
    await store.appendLabel(store.entries[0]!.id, '关键节点');
    await store.appendCustom('todo_snapshot', { items: [] });

    const types = store.entries.map(entry => entry.type);

    expect(types).toEqual(['message', 'model_change', 'compaction', 'session_info', 'label', 'custom']);
  });

  it('message 序列化往返：四种 role + content parts 组合', async () => {
    const store = await SessionStore.create(path.join(dir, 'a.jsonl'), { cwd: '/w' });

    await store.appendMessage({ role: 'system', content: '你是助手' });
    await store.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }
      ]
    });
    await store.appendMessage({
      role: 'assistant',
      toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'x' } }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    });
    await store.appendMessage({
      role: 'tool',
      toolCallId: 'call_1',
      toolName: 'web_search',
      output: { results: [] }
    });

    const reopened = await SessionStore.open(path.join(dir, 'a.jsonl'));
    const messages = reopened.entries
      .filter(entry => entry.type === 'message')
      .map(entry => (entry as { message: unknown }).message);

    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: 'system', content: '你是助手' });
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }
      ]
    });
    expect(messages[2]).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'call_1' }] });
    expect(messages[3]).toMatchObject({ role: 'tool', toolCallId: 'call_1' });
  });
});

describe('setLeafId 分支语义', () => {
  it('切到旧 entry：后续 append 挂在旧分支下（前缀共享）', async () => {
    const store = await SessionStore.create(path.join(dir, 'a.jsonl'), { cwd: '/w' });

    const m1 = await store.appendMessage({ role: 'user', content: 'q1' });
    await store.appendMessage({ role: 'assistant', content: 'a1' });

    await store.setLeafId(m1.id);
    const branchMessage = await store.appendMessage({ role: 'assistant', content: 'a2 重生成' });

    expect(branchMessage.parentId).toBe(m1.id);
    expect(store.getPathToRoot().map(entry => entry.id)).toEqual([m1.id, branchMessage.id]);
  });

  it('setLeafId(null) 回到自然 leaf；branch_selected 落盘原始 null 意图', async () => {
    const store = await SessionStore.create(path.join(dir, 'a.jsonl'), { cwd: '/w' });

    const m1 = await store.appendMessage({ role: 'user', content: 'q1' });
    const m2 = await store.appendMessage({ role: 'assistant', content: 'a1' });

    await store.setLeafId(m1.id);
    await store.setLeafId(null);

    // 落盘意图忠实保留 null。
    const branchEntries = store.entries.filter(entry => entry.type === 'branch_selected');
    expect(branchEntries.at(-1)).toMatchObject({ type: 'branch_selected', targetId: null });
    expect(store.currentLeafId).toBe(m2.id);

    // 重开后 leaf 解析回 m2（自然 leaf）。
    const reopened = await SessionStore.open(path.join(dir, 'a.jsonl'));
    expect(reopened.currentLeafId).toBe(m2.id);
  });

  it('悬空 targetId 拒绝切换', async () => {
    const store = await SessionStore.create(path.join(dir, 'a.jsonl'), { cwd: '/w' });

    await expect(store.setLeafId('ghost')).rejects.toThrow(/unknown entry/);
  });
});

describe('单写者串行', () => {
  it('并发 append 不产生交错损坏：全部落盘且 parentId 链完整', async () => {
    const store = await SessionStore.create(path.join(dir, 'a.jsonl'), { cwd: '/w' });

    await Promise.all(
      Array.from({ length: 25 }, (_, index) => store.appendMessage({ role: 'user', content: `m${index}` }))
    );

    const reopened = await SessionStore.open(path.join(dir, 'a.jsonl'));

    expect(reopened.entries).toHaveLength(25);
    expect(reopened.skippedMidLines).toBe(0);

    // 链完整：每个 entry 的 parentId 都是链上前一个。
    let expectedParent: string | null = null;

    for (const entry of reopened.entries) {
      expect(entry.parentId).toBe(expectedParent);
      expectedParent = entry.id;
    }
  });
});
