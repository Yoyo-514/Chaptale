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
  it('生成摘要并落 compaction entry；firstKeptEntryId = 压缩时 leaf', async () => {
    mockSummary('用户与助手讨论第一章开场设计，方向定为雨夜开场。');
    const leafBeforeCompact = store.currentLeafId;

    const result = await compactSession({ model: createModel(), store, prompt: '请压缩以下对话' });

    expect(result.summary).toContain('雨夜开场');
    expect(result.firstKeptEntryId).toBe(leafBeforeCompact);
    expect(result.tokensBefore).toBeGreaterThan(0);

    // 落盘验证：重开后 compaction 生效（上下文折叠为摘要 + 保留消息）。
    const reopened = await SessionStore.open(path.join(dir, 's.jsonl'));
    const compactEntry = reopened.entries.find(entry => entry.type === 'compaction');

    expect(compactEntry).toMatchObject({ type: 'compaction', firstKeptEntryId: leafBeforeCompact });

    // 回放：leaf（"继续"）按语义保留，之前的消息折叠进摘要。
    const context = reopened.buildContextMessages();

    expect(context).toHaveLength(2);
    expect(context[0]).toMatchObject({ role: 'user', content: '用户与助手讨论第一章开场设计，方向定为雨夜开场。' });
    expect(context[1]).toEqual({ role: 'user', content: '继续' });
  });

  it('空会话拒绝压缩', async () => {
    const emptyStore = await SessionStore.create(path.join(dir, 'empty.jsonl'), { cwd: '/w' });

    await expect(compactSession({ model: createModel(), store: emptyStore, prompt: 'p' })).rejects.toThrow(
      /没有可压缩/
    );
  });

  it('空摘要结果报错（不落流）', async () => {
    mockSummary('   ');
    const entriesBefore = store.entries.length;

    await expect(compactSession({ model: createModel(), store, prompt: 'p' })).rejects.toThrow(/压缩结果为空/);
    expect(store.entries).toHaveLength(entriesBefore);
  });
});
