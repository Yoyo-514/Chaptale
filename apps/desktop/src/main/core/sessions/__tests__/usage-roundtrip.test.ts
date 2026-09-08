import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@chaptale/shared';
import { sumTokenUsage } from '@chaptale/shared';

import { createPartTranslator } from '../../../features/agent/part-translator';
import { AgentRunStore } from '../../../features/runs/store';
import { stepRecordsToSessionMessages, toModelMessages } from '../../agent/messages';
import { normalizeModelUsage } from '../../models/token-usage';
import { SessionStore } from '../store';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-usage-roundtrip-'));
});
afterEach(async () => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^chaptale-usage-roundtrip-/);
  await rm(root, { recursive: true, force: true });
});

describe('缓存用量贯通', () => {
  it('流式投影与磁盘重开保留相同分项，但用量不进入模型回放', async () => {
    const modelUsage = {
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      raw: { input_tokens: 1000, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 } }
    };
    const usage = normalizeModelUsage(modelUsage);
    const emitted: ChatMessage[] = [];
    const translator = createPartTranslator(message => emitted.push(message));
    translator.consume({ type: 'text-delta', text: '候选片段' });
    translator.consume({ type: 'finish-step', usage: modelUsage });
    expect(emitted.at(-1)).toMatchObject({ role: 'assistant', usage });

    const filename = path.join(root, 'session.jsonl');
    const store = await SessionStore.create(filename, { cwd: root, id: 'usage' });
    await store.appendMessage({ role: 'user', content: '起草' });
    for (const message of stepRecordsToSessionMessages({ text: '候选片段', toolCalls: [], usage }, [])) {
      await store.appendMessage(message);
    }
    const reopened = await SessionStore.open(filename);
    expect(reopened.entries.at(-1)).toMatchObject({ message: { usage } });
    expect(JSON.stringify(toModelMessages(reopened.buildContextMessages()))).not.toContain('readTokens');
    expect(await readFile(filename, 'utf8')).not.toContain('input_tokens_details');
  });

  it('失败运行也保存多步已报告用量，未知步骤不能变成完整缓存命中', async () => {
    const usage = sumTokenUsage([
      normalizeModelUsage({
        inputTokens: 1000,
        outputTokens: 100,
        raw: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 600 } }
      }),
      normalizeModelUsage({ inputTokens: 40, outputTokens: 0 })
    ]);
    const runs = new AgentRunStore({ resolveCwd: () => root });
    await runs.append({
      id: 'failed-usage',
      personaId: 'draft',
      execution: 'task',
      trigger: 'ui-action',
      promptTemplateHash: 'a'.repeat(64),
      cachePolicy: 'openai-explicit',
      inputDigest: { brief: '失败后的用量留档' },
      memoryRefs: [],
      status: 'failed',
      usage,
      createdAt: new Date().toISOString()
    });
    const read = (await new AgentRunStore({ resolveCwd: () => root }).list()).records[0]!;
    expect(read.usage).toEqual(usage);
    expect(read.usage.cache).toEqual({ readTokens: 0, writeTokens: 600, uncachedTokens: 400, partial: true });
    expect(read.cachePolicy).toBe('openai-explicit');
  });
});
