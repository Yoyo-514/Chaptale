import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@chaptale/shared';

import { createProtocolLanguageModel } from '../../../core/models/protocols';
import type { ResolvedModel } from '../../../core/models/runtime';
import { SessionStore } from '../../../core/sessions/store';
import type { ToolDefinition } from '../../../core/tool-protocol/definition';
import { CoreSessionRepository } from '../../sessions/core-repository';
import { AgentService, type ChatRuntimeBundle } from '../service';

let dir: string;
let repository: CoreSessionRepository;
let service: AgentService;
let abortController: AbortController;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-agent-service-'));
  repository = new CoreSessionRepository({
    rootDir: dir,
    cwd: '/workspace',
    sessionDir: path.join(dir, 'sessions', 'global'),
    sessionsRootDir: path.join(dir, 'sessions')
  });
  service = new AgentService({
    sessionRepository: repository,
    modelService: {} as never,
    runtimeBundle: createBundle(),
    gate: { check: async () => ({ outcome: 'allow-once' }) },
    compactPrompt: '请压缩'
  });
  abortController = new AbortController();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      }
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
}

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

function mockModelSequence(responses: string[][]) {
  const fetchMock = vi.fn();

  for (const chunks of responses) {
    fetchMock.mockResolvedValueOnce(sseResponse(chunks));
  }

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function textRound(text: string) {
  return [
    sse({ id: '1', choices: [{ index: 0, delta: { content: text } }] }),
    sse({
      id: '1',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }),
    'data: [DONE]\n\n'
  ];
}

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

const echoTool: ToolDefinition = {
  name: 'echo',
  label: '回显',
  description: '回显文本',
  riskLevel: 'readonly',
  parameters: Type.Object({ text: Type.String() }, { additionalProperties: false }),
  execute: async params => ({ text: `回显：${(params as { text: string }).text}` })
};

function createBundle(tools: ToolDefinition[] = [echoTool]): ChatRuntimeBundle {
  return {
    resolve: async () => ({
      model: createModel(),
      system: '你是助手',
      tools
    })
  };
}

function runOptions(query: string, sessionId = 's1') {
  return {
    runId: 'r1',
    sessionId,
    query,
    signal: abortController.signal
  };
}

describe('AgentService.stream', () => {
  it('单轮文本：user 回显 + assistant 定稿 + 落盘可回放', async () => {
    mockModelSequence([textRound('雨夜开场建议。')]);

    const messages: ChatMessage[] = [];

    for await (const message of service.stream(runOptions('第一章怎么写'))) {
      messages.push(message);
    }

    // 首条 user 回显，随后 assistant 定稿。
    expect(messages[0]).toMatchObject({ role: 'user', content: '第一章怎么写' });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '雨夜开场建议。'
    });
    expect(messages[1]).toHaveProperty('usage');

    // 落盘验证：重开会话回放一致。
    const store = await SessionStore.open(path.join(dir, 'sessions', 'global', 's1.jsonl'));
    const replay = store.buildContextMessages();

    expect(replay).toEqual([
      { role: 'user', content: '第一章怎么写' },
      expect.objectContaining({ role: 'assistant', content: '雨夜开场建议。' })
    ]);
  });

  it('工具轮次：assistant(toolCall) → toolResult → 续答定稿，全部推送与落盘', async () => {
    mockModelSequence([
      [
        sse({
          id: '1',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"text":"你好"}' } }
                ]
              }
            }
          ]
        }),
        sse({
          id: '1',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        }),
        'data: [DONE]\n\n'
      ],
      textRound('已回显完毕。')
    ]);

    const messages: ChatMessage[] = [];

    for await (const message of service.stream(runOptions('回显 你好'))) {
      messages.push(message);
    }

    const roles = messages.map(message => message.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);

    expect(messages[1]).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'call_1', name: 'echo', arguments: { text: '你好' } }]
    });
    expect(messages[2]).toMatchObject({ role: 'tool', toolCallId: 'call_1', toolName: 'echo' });
    expect(messages[3]).toMatchObject({ role: 'assistant', content: '已回显完毕。' });

    // 落盘：assistant(toolCalls) / tool / assistant 三组 + 首条 user。
    const store = await SessionStore.open(path.join(dir, 'sessions', 'global', 's1.jsonl'));
    const roles2 = store.buildContextMessages().map(message => message.role);

    expect(roles2).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('branchFromEntryId：切到历史节点重生成（新分支）', async () => {
    // 预置历史：user A / assistant 答案一。
    const seed = await repository.openOrCreate('s1', '/w');
    const userEntry = await seed.appendMessage({ role: 'user', content: 'A' });
    await seed.appendMessage({ role: 'assistant', content: '答案一' });

    mockModelSequence([textRound('答案二（重生成）')]);

    const messages: ChatMessage[] = [];

    for await (const message of service.stream({
      ...runOptions('A'),
      branchFromEntryId: userEntry.id
    })) {
      messages.push(message);
    }

    // 重生成语义：切到 user A 节点后追加重发 → 路径 = A → A(重发) → 答案二；
    // 原答案一成为旁支（不在当前路径）。
    const store = await SessionStore.open(path.join(dir, 'sessions', 'global', 's1.jsonl'));
    const replay = store.buildContextMessages();

    expect(replay.map(message => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(JSON.stringify(replay)).not.toContain('答案一');
    expect(JSON.stringify(replay)).toContain('答案二');
    void messages;
  });

  it('abort：流立即终止且已落盘内容保留', async () => {
    let releaseStream!: () => void;
    const gated = new Promise<void>(resolve => {
      releaseStream = resolve;
    });
    const encoder = new TextEncoder();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(sse({ id: '1', choices: [{ index: 0, delta: { content: '部分输出' } }] }))
            );
            void gated.then(() => controller.close());
          }
        });

        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      })
    );

    const collected: ChatMessage[] = [];
    const iterator = service.stream(runOptions('长文'));

    const first = await iterator.next();
    collected.push(first.value as ChatMessage);

    abortController.abort();
    releaseStream();

    await expect(iterator.next()).rejects.toThrow();

    // user 消息已落盘。
    const store = await SessionStore.open(path.join(dir, 'sessions', 'global', 's1.jsonl'));
    expect(store.buildContextMessages()[0]).toMatchObject({ role: 'user', content: '长文' });
    void collected;
  });

  it('steer：当前轮结束后续跑队列消息', async () => {
    // 第一轮长流：等待 steer 注入后再放行完成块。
    let releaseFirst!: () => void;
    const firstRoundGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const fetchMock = vi.fn();
    fetchMock.mockImplementationOnce(async () => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(sse({ id: '1', choices: [{ index: 0, delta: { content: '第一轮' } }] })));
          void firstRoundGate.then(() => {
            controller.enqueue(
              encoder.encode(
                sse({
                  id: '1',
                  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 1, completion_tokens: 1 }
                })
              )
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          });
        }
      });

      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    fetchMock.mockResolvedValueOnce(sseResponse(textRound('第二轮响应')));
    vi.stubGlobal('fetch', fetchMock);

    const messages: ChatMessage[] = [];
    const iterator = service.stream(runOptions('第一问'));

    // 首条 user 回显立即到达；首轮 assistant 尚被 gate 卡住。
    const first = await iterator.next();
    expect(first.value).toMatchObject({ role: 'user', content: '第一问' });

    // 运行中注入 steer，再放行首轮完成。
    await service.steer({ sessionId: 's1', query: '第二问', signal: abortController.signal });
    releaseFirst();

    for (let message = await iterator.next(); !message.done; message = await iterator.next()) {
      messages.push(message.value);
    }

    // 两轮 user 与 assistant 均推送。
    const contents = JSON.stringify(messages);
    expect(contents).toContain('第二问');
    expect(contents).toContain('第二轮响应');
  });

  it('同会话运行中拒绝新的 stream（防 JSONL 交错写入）', async () => {
    let releaseFirst!: () => void;
    const firstRoundGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(sse({ id: '1', choices: [{ index: 0, delta: { content: '首轮' } }] })));
            void firstRoundGate.then(() => {
              controller.enqueue(
                encoder.encode(
                  sse({
                    id: '1',
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 1, completion_tokens: 1 }
                  })
                )
              );
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            });
          }
        });

        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      })
    );

    const first = service.stream(runOptions('第一问'));
    const firstMessage = await first.next();
    expect(firstMessage.value).toMatchObject({ role: 'user', content: '第一问' });

    // 首轮仍挂起（gate 未释放），第二个 stream 同会话应被拒绝。
    const second = service.stream(runOptions('第二问'));
    await expect(second.next()).rejects.toThrow(/正在运行中/);

    releaseFirst();
    await first.return?.(undefined).catch(() => undefined);
  });

  it('memory 注入器前缀进入落盘内容，UI 回显保持纯净', async () => {
    mockModelSequence([textRound('回答。')]);

    const memoryService = new AgentService({
      sessionRepository: repository,
      modelService: {} as never,
      runtimeBundle: createBundle(),
      gate: { check: async () => ({ outcome: 'allow-once' }) },
      compactPrompt: '请压缩',
      memoryInjector: {
        resolvePrefix: async () => '【记忆：林晚左臂为义肢】\n\n'
      }
    });

    const messages: ChatMessage[] = [];

    for await (const message of memoryService.stream(runOptions('继续写'))) {
      messages.push(message);
    }

    // 落盘内容含记忆前缀（模型每轮可见），且与用户文本同一条消息。
    const store = await SessionStore.open(path.join(dir, 'sessions', 'global', 's1.jsonl'));
    const first = store.buildContextMessages()[0];
    expect(first).toMatchObject({ role: 'user', content: expect.stringContaining('【记忆：林晚左臂为义肢】') });
    expect(first).toMatchObject({ role: 'user', content: expect.stringContaining('继续写') });

    // UI 回显不含记忆前缀，聊天面板保持纯净。
    const echo = messages.find(message => message.role === 'user');
    expect(echo?.content).toBe('继续写');
  });
});

describe('AgentService 其余端口', () => {
  it('getContextPressure：估算 token 与百分比', async () => {
    await repository.openOrCreate('s1', '/w');
    const seed = await repository.open('s1');
    await seed.appendMessage({ role: 'user', content: 'x'.repeat(1000) });

    const pressure = await service.getContextPressure('s1');

    expect(pressure.contextWindow).toBe(128_000);
    expect(pressure.tokens).toBeGreaterThan(0);
    expect(pressure.percent).toBe(0); // 500/128000 不足 1%，四舍五入为 0
  });

  it('getContextPressure：图片按块估算而非 base64 长度（一张大图不应打爆百分比）', async () => {
    await repository.openOrCreate('s-img', '/w');
    const store = await repository.open('s-img');
    await store.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: '看看这两张图' },
        { type: 'image', mimeType: 'image/png', data: 'A'.repeat(600_000) },
        { type: 'image', mimeType: 'image/jpeg', data: 'B'.repeat(300_000) }
      ]
    });

    const pressure = await service.getContextPressure('s-img');

    // 2 张图 × 1500 + 短文本 ≈ 3004 tokens → 约 2%，而非 base64 长度算出的 350%+。
    expect(pressure.tokens).toBeLessThan(4_000);
    expect(pressure.percent).toBeLessThanOrEqual(3);
  });

  it('clearPendingMessages：非活跃会话返回空集合', async () => {
    const cleared = await service.clearPendingMessages({
      sessionId: 'ghost',
      signal: abortController.signal
    });

    expect(cleared).toEqual({ steering: [], followUp: [] });
  });
});
