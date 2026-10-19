import { createAssistantMessageEventStream, InMemoryCredentialStore, type Message } from '@earendil-works/pi-ai';
import { type AgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHostSession } from '../../index.ts';
import { writingCompactionInstructions } from '../compaction.ts';

const model = { provider: 'compaction-capture', id: 'capture-model' };
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

let root: string;
let cwd: string;
let agentDir: string;
let runtime: ModelRuntime;
let captured: Message[][];
let sessions: AgentSession[];

beforeEach(async () => {
  sessions = [];
  captured = [];
  root = await mkdtemp(join(tmpdir(), 'chaptale-compaction-'));
  cwd = join(root, 'work');
  agentDir = join(root, 'agent');
  await mkdir(cwd);
  await mkdir(agentDir);
  runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false
  });
  // 只记录总结请求并返回错误，不生成模型回复。
  runtime.registerProvider(model.provider, {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-capture',
    api: 'compaction-capture',
    models: [
      {
        id: model.id,
        name: model.id,
        reasoning: false,
        input: ['text'],
        contextWindow: 200_000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    streamSimple: (target, context) => {
      captured.push(structuredClone(context.messages));
      const stream = createAssistantMessageEventStream();
      const error = {
        role: 'assistant' as const,
        content: [],
        api: target.api,
        provider: target.provider,
        model: target.id,
        usage: zeroUsage,
        stopReason: 'error' as const,
        errorMessage: '离线测试不请求模型',
        timestamp: Date.now()
      };
      queueMicrotask(() => stream.push({ type: 'error', reason: 'error', error }));
      return stream;
    }
  });
});

afterEach(async () => {
  for (const session of sessions) session.dispose();
  await rm(root, { recursive: true, force: true });
});

/** 十轮对话，每条回复按 pi 估算约 1000 token，合计低于默认保留量 20000。 */
async function openWith(reply: (turn: number) => string) {
  const sessionManager = SessionManager.inMemory(cwd);
  for (let turn = 0; turn < 10; turn++) {
    sessionManager.appendMessage({ role: 'user', content: `第${turn}轮`, timestamp: Date.now() });
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: reply(turn) }],
      api: 'compaction-capture',
      provider: model.provider,
      model: model.id,
      usage: zeroUsage,
      stopReason: 'stop',
      timestamp: Date.now()
    });
  }
  const { session } = await createHostSession({
    cwd,
    agentDir,
    systemPrompt: '你是创作助手。',
    modelRuntime: runtime,
    model,
    sessionManager
  });
  sessions.push(session);
  return session;
}

function summaryPrompt(): string {
  const content = captured[0]?.find(message => message.role === 'user')?.content;
  return Array.isArray(content) ? content.map(block => ('text' in block ? block.text : '')).join('') : '';
}

describe('写作向压缩', () => {
  it('中文对话按字符占比缩小保留量，并使用写作向总结要求', async () => {
    const session = await openWith(turn => `章节${turn}：${'雾'.repeat(3995)}`);

    await expect(session.compact()).rejects.toThrow('离线测试不请求模型');

    // 纯中文保留量降为 5000，前几轮进入总结，最近几轮原样保留。
    const prompt = summaryPrompt();
    expect(prompt).toContain('章节0：');
    expect(prompt).not.toContain('章节9：');
    expect(prompt).toContain(writingCompactionInstructions);
  });

  it('英文对话沿用 pi 的保留量，不足时不压缩', async () => {
    const session = await openWith(turn => `Chapter ${turn}: ${'fog '.repeat(997)}`);

    await expect(session.compact()).rejects.toThrow('Nothing to compact');
    expect(captured).toEqual([]);
  });
});
