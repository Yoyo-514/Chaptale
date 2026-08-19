import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProtocolLanguageModel } from '../../models/protocols';
import type { ResolvedModel } from '../../models/runtime';
import { SessionStore } from '../../sessions/store';
import { compactSession } from '../compact';

let dir: string;
let store: SessionStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-compact-'));
  store = await SessionStore.create(path.join(dir, 's.jsonl'), { cwd: '/w' });
  await store.appendMessage({ role: 'user', content: '第一章写什么' });
  await store.appendMessage({ role: 'assistant', content: '建议从雨夜开场，先写主角进城的段落。' });
  await store.appendMessage({ role: 'user', content: '继续' });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function createModel(): ResolvedModel {
  return {
    model: createProtocolLanguageModel(
      { providerId: 't', api: 'openai-completions', baseUrl: 'https://t.local/v1', apiKey: 'k' },
      'm'
    ),
    provider: 't',
    modelId: 'm',
    contextWindow: 128_000,
    input: ['text']
  };
}

function mockSummary(summary: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: summary } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 }
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    )
  );
}

describe('compactSession', () => {
  it('短会话：退回只保留最后一轮，摘要覆盖其余', async () => {
    mockSummary('用户与助手讨论第一章开场设计，方向定为雨夜开场。');
    const leafBeforeCompact = store.currentLeafId;

    const result = await compactSession({ model: createModel(), store, prompt: '请压缩以下对话' });

    expect(result.summary).toContain('雨夜开场');
    // 三条消息远在预算内，切点退回最后一个 user——此处恰为压缩时刻的 leaf。
    expect(result.firstKeptEntryId).toBe(leafBeforeCompact);
    expect(result.tokensBefore).toBeGreaterThan(0);

    // 落盘验证：重开后 compaction 生效（上下文折叠为摘要 + 保留消息）。
    const reopened = await SessionStore.open(path.join(dir, 's.jsonl'));
    const compactEntry = reopened.entries.find(entry => entry.type === 'compaction');

    expect(compactEntry).toMatchObject({ type: 'compaction', firstKeptEntryId: leafBeforeCompact });

    const context = reopened.buildContextMessages();

    expect(context).toHaveLength(2);
    expect(context[0]).toMatchObject({ role: 'user', content: '用户与助手讨论第一章开场设计，方向定为雨夜开场。' });
    expect(context[1]).toEqual({ role: 'user', content: '继续' });
  });

  it('长会话：按预算保留近期原文，不再只剩最后一条', async () => {
    // 每条约 404 token（400 中文字 + 协议开销）；预算 2000 → 应保留 4 条左右。
    for (let index = 0; index < 12; index += 1) {
      await store.appendMessage({ role: 'assistant', content: `第${index}段正文`.padEnd(400, '文') });
    }

    mockSummary('前半段的讨论摘要。');

    const result = await compactSession({
      model: createModel(),
      store,
      prompt: '请压缩以下对话',
      keepRecentTokens: 2000
    });

    const reopened = await SessionStore.open(path.join(dir, 's.jsonl'));
    const context = reopened.buildContextMessages();

    // 修复前这里恒为 2（摘要 + 最后一条），近期原文全部丢弃。
    expect(context.length).toBeGreaterThanOrEqual(4);
    expect(context[0]).toMatchObject({ role: 'user', content: '前半段的讨论摘要。' });

    // 保留区间必须以切点那条开头，且最后一条原文仍在。
    expect(result.firstKeptEntryId).not.toBe(store.currentLeafId);
    expect(context.at(-1)).toMatchObject({ role: 'assistant' });
    expect(String((context.at(-1) as { content: string }).content)).toContain('第11段');
  });

  it('压缩时只把折叠区间交给模型，保留区间不重复送去总结', async () => {
    for (let index = 0; index < 12; index += 1) {
      await store.appendMessage({ role: 'assistant', content: `第${index}段正文`.padEnd(400, '文') });
    }

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '摘要' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await compactSession({ model: createModel(), store, prompt: 'p', keepRecentTokens: 1200 });

    const body = String(
      (fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body
    );

    expect(body).toContain('第0段');
    // 保留区间的原文会逐字进入后续上下文，再送去总结既费 token 又与保留原文重复。
    expect(body).not.toContain('第11段');
  });

  it('空会话拒绝压缩', async () => {
    const emptyStore = await SessionStore.create(path.join(dir, 'empty.jsonl'), { cwd: '/w' });

    await expect(compactSession({ model: createModel(), store: emptyStore, prompt: 'p' })).rejects.toThrow(
      /没有可压缩/
    );
  });

  it('只有一条消息时拒绝压缩（折不出内容）', async () => {
    const tinyStore = await SessionStore.create(path.join(dir, 'tiny.jsonl'), { cwd: '/w' });
    await tinyStore.appendMessage({ role: 'user', content: '你好' });

    await expect(compactSession({ model: createModel(), store: tinyStore, prompt: 'p' })).rejects.toThrow(
      /还不足以压缩/
    );
  });

  it('空摘要结果报错（不落流）', async () => {
    mockSummary('   ');
    const entriesBefore = store.entries.length;

    await expect(compactSession({ model: createModel(), store, prompt: 'p' })).rejects.toThrow(/压缩结果为空/);
    expect(store.entries).toHaveLength(entriesBefore);
  });
});
