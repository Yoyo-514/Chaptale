import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProtocolLanguageModel } from '../../models/protocols';
import type { ResolvedModel } from '../../models/runtime';
import { SessionStore } from '../../sessions/store';
import type { CompactSummaryInput, CompactSummarizer } from '../compact';
import { compactSession } from '../compact';

let dir: string;
let store: SessionStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-compact-'));
  store = await SessionStore.create(path.join(dir, 's.jsonl'), { cwd: '/w', id: 'session-1' });
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

/** 摘要生产者替身：记录收到的输入，便于断言折叠区间与预算。 */
function stubSummarizer(summary: string) {
  const seen: CompactSummaryInput[] = [];
  const summarize: CompactSummarizer = async input => {
    seen.push(input);

    return {
      summary,
      summaryRef: '.chaptale/memory/summaries/compactions/session-1-abcd1234.md',
      runId: 'run-distill',
      memoryRefs: ['author:preferences']
    };
  };

  return { summarize, seen };
}

/** 检查点落盘失败的替身：此时整个压缩必须取消。 */
const failingSummarizer: CompactSummarizer = async () => {
  throw new Error('memory 检查点落盘失败：磁盘只读');
};

async function bulkAppend(count: number) {
  for (let index = 0; index < count; index += 1) {
    await store.appendMessage({ role: 'assistant', content: `第${index}段正文`.padEnd(400, '文') });
  }
}

describe('compactSession', () => {
  it('短会话：退回只保留最后一轮，摘要覆盖其余', async () => {
    const { summarize } = stubSummarizer('用户与助手讨论第一章开场设计，方向定为雨夜开场。');
    const leafBeforeCompact = store.currentLeafId;

    const result = await compactSession({ sessionId: 'session-1', model: createModel(), store, summarize });

    expect(result.summary).toContain('雨夜开场');
    // 三条消息远在预算内，切点退回最后一个 user——此处恰为压缩时刻的 leaf。
    expect(result.firstKeptEntryId).toBe(leafBeforeCompact);
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.estimatedTokensAfter).toBeLessThan(result.tokensBefore);

    const reopened = await SessionStore.open(path.join(dir, 's.jsonl'));
    const context = reopened.buildContextMessages();

    expect(context).toHaveLength(2);
    expect(context[0]).toMatchObject({ role: 'user', content: '用户与助手讨论第一章开场设计，方向定为雨夜开场。' });
    expect(context[1]).toEqual({ role: 'user', content: '继续' });
  });

  it('长会话：按预算保留近期原文，不再只剩最后一条', async () => {
    // 每条约 404 token（400 中文字 + 协议开销）；预算 2000 → 应保留 4 条左右。
    await bulkAppend(12);
    const { summarize } = stubSummarizer('前半段的讨论摘要。');

    const result = await compactSession({
      sessionId: 'session-1',
      model: createModel(),
      store,
      summarize,
      keepRecentTokens: 2000
    });

    const reopened = await SessionStore.open(path.join(dir, 's.jsonl'));
    const context = reopened.buildContextMessages();

    // 修复前这里恒为 2（摘要 + 最后一条），近期原文全部丢弃。
    expect(context.length).toBeGreaterThanOrEqual(4);
    expect(context[0]).toMatchObject({ role: 'user', content: '前半段的讨论摘要。' });
    expect(result.firstKeptEntryId).not.toBe(store.currentLeafId);
    expect(String((context.at(-1) as { content: string }).content)).toContain('第11段');
  });

  it('只把折叠区间交给摘要生产者，保留区间不重复送去总结', async () => {
    await bulkAppend(12);
    const { summarize, seen } = stubSummarizer('摘要');

    await compactSession({ sessionId: 'session-1', model: createModel(), store, summarize, keepRecentTokens: 2000 });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.conversation).toContain('第0段');
    // 保留区间的原文会逐字进入后续上下文，再送去总结既费 token 又与保留原文重复。
    expect(seen[0]!.conversation).not.toContain('第11段');
  });

  it('把检查点定位信息交给生产者：会话 id、会话 cwd、切点即幂等标识', async () => {
    const { summarize, seen } = stubSummarizer('摘要');

    const result = await compactSession({ sessionId: 'session-1', model: createModel(), store, summarize });

    expect(seen[0]).toMatchObject({
      sessionId: 'session-1',
      // 压缩必须用会话创建时绑定的工作区，不能改读全局 currentCwd。
      cwd: '/w',
      reason: 'manual',
      checkpointId: result.firstKeptEntryId
    });
    expect(seen[0]!.maxInputTokens).toBeGreaterThan(0);
  });

  it('二次压缩把上一轮摘要一并折入，否则它承载的历史会丢', async () => {
    const first = stubSummarizer('第一轮摘要：讨论了雨夜开场。');
    await compactSession({ sessionId: 'session-1', model: createModel(), store, summarize: first.summarize });

    await bulkAppend(12);

    const second = stubSummarizer('第二轮摘要');
    await compactSession({
      sessionId: 'session-1',
      model: createModel(),
      store,
      summarize: second.summarize,
      keepRecentTokens: 2000
    });

    expect(second.seen[0]!.previousSummary).toBe('第一轮摘要：讨论了雨夜开场。');
  });

  it('检查点引用与蒸馏 runId 随结果返回并落进 compaction entry', async () => {
    const { summarize } = stubSummarizer('摘要');

    const result = await compactSession({ sessionId: 'session-1', model: createModel(), store, summarize });

    expect(result.summaryRef).toContain('summaries/compactions/');
    expect(result.runId).toBe('run-distill');

    const reopened = await SessionStore.open(path.join(dir, 's.jsonl'));
    const entry = reopened.entries.find(item => item.type === 'compaction');

    expect(entry).toMatchObject({
      details: { reason: 'manual', distillerRunId: 'run-distill', memoryRefs: ['author:preferences'] }
    });
  });

  it('生产者失败即取消压缩：不写任何 entry，会话保持原样', async () => {
    const entriesBefore = store.entries.length;

    await expect(
      compactSession({ sessionId: 'session-1', model: createModel(), store, summarize: failingSummarizer })
    ).rejects.toThrow(/磁盘只读/);

    // 检查点落盘失败必须取消压缩，不能留下半截状态。
    expect(store.entries).toHaveLength(entriesBefore);
  });

  it('空会话拒绝压缩', async () => {
    const emptyStore = await SessionStore.create(path.join(dir, 'empty.jsonl'), { cwd: '/w' });
    const { summarize } = stubSummarizer('摘要');

    await expect(
      compactSession({ sessionId: 'session-1', model: createModel(), store: emptyStore, summarize })
    ).rejects.toThrow(/没有可压缩/);
  });

  it('只有一条消息时拒绝压缩（折不出内容）', async () => {
    const tinyStore = await SessionStore.create(path.join(dir, 'tiny.jsonl'), { cwd: '/w' });
    await tinyStore.appendMessage({ role: 'user', content: '你好' });
    const { summarize } = stubSummarizer('摘要');

    await expect(
      compactSession({ sessionId: 'session-1', model: createModel(), store: tinyStore, summarize })
    ).rejects.toThrow(/还不足以压缩/);
  });

  it('空摘要结果报错（不落流）', async () => {
    const entriesBefore = store.entries.length;
    const { summarize } = stubSummarizer('   ');

    await expect(compactSession({ sessionId: 'session-1', model: createModel(), store, summarize })).rejects.toThrow(
      /压缩结果为空/
    );
    expect(store.entries).toHaveLength(entriesBefore);
  });
});
