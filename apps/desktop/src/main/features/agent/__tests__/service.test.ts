import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@chaptale/shared';

import type { CompactSummarizer } from '../../../core/agent/compact';
import { createProtocolLanguageModel } from '../../../core/models/protocols';
import type { ResolvedModel } from '../../../core/models/runtime';
import { SessionStore } from '../../../core/sessions/store';
import type { ToolDefinition } from '../../../core/tool-protocol/definition';
import { JsonlSessionRepository } from '../../sessions/repository';
import { AgentService, type ChatRuntimeBundle } from '../service';

let dir: string;
let repository: JsonlSessionRepository;
let service: AgentService;
let abortController: AbortController;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-agent-service-'));
  repository = new JsonlSessionRepository({
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
    compactSummarizer: stubSummarizer
  });
  abortController = new AbortController();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** 压缩摘要生产者替身：生产装配的是创作检查点管线，此处只需一个合法产物。 */
const stubSummarizer: CompactSummarizer = async () => ({
  summary: '会话摘要',
  summaryRef: '.chaptale/memory/summaries/compactions/stub.md',
  runId: 'run-stub',
  memoryRefs: []
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

function createBundle(tools: ToolDefinition[] = [echoTool], model = createModel()): ChatRuntimeBundle {
  return {
    resolveModel: async () => model,
    resolve: async () => ({
      model,
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

    // 首条 user 回显；文本先以增量 partial 流出（UI 侧 pushText 追加语义），finish-step 再全量定稿。
    expect(messages[0]).toMatchObject({ role: 'user', content: '第一章怎么写' });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '雨夜开场建议。',
      partial: true
    });

    const settled = messages.at(-1)!;

    expect(settled).toMatchObject({
      role: 'assistant',
      content: '雨夜开场建议。',
      partial: false
    });
    expect(settled).toHaveProperty('usage');

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

    // 工具名一到就亮卡片（参数尚空），参数解析完再覆盖同 ID 的卡片，
    // 结果紧随其后，本步再定稿；末轮文本同样先增量后定稿。
    expect(roles).toEqual(['user', 'assistant', 'assistant', 'tool', 'assistant', 'assistant', 'assistant']);

    // 提前亮起的那张：有工具名，参数还没到。
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      partial: true,
      toolCalls: [{ id: 'call_1', name: 'echo', arguments: {} }]
    });
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      partial: true,
      toolCalls: [{ id: 'call_1', name: 'echo', arguments: { text: '你好' } }]
    });
    expect(messages[3]).toMatchObject({ role: 'tool', toolCallId: 'call_1', toolName: 'echo' });
    expect(messages[4]).toMatchObject({
      role: 'assistant',
      partial: false,
      // 定稿只带一条调用：提前亮的那张与参数完整的那张是同一个 ID。
      toolCalls: [{ id: 'call_1', name: 'echo', arguments: { text: '你好' } }]
    });
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: '已回显完毕。', partial: false });

    // 落盘：assistant(toolCalls) / tool / assistant 三组 + 首条 user。
    const store = await SessionStore.open(path.join(dir, 'sessions', 'global', 's1.jsonl'));
    const roles2 = store.buildContextMessages().map(message => message.role);

    expect(roles2).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  /**
   * 参数边生成边展示。
   *
   * 写一整章时参数要流很久：没有这条，作者会对着"正在调用 write"却不知道
   * 动的是哪个文件，一直等到整章生成完。
   */
  it('工具参数流式预览：主参数一完整就显示出来', async () => {
    const body = '雨'.repeat(400);
    const argumentChunk = (fragment: string) =>
      sse({
        id: '1',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: fragment } }] } }]
      });

    mockModelSequence([
      [
        sse({
          id: '1',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'echo', arguments: '' } }]
              }
            }
          ]
        }),
        // 参数分片到达：模型一个 token 一个 token 地写正文。
        argumentChunk('{"text":"'),
        ...Array.from({ length: 4 }, () => argumentChunk('雨'.repeat(100))),
        argumentChunk('"}'),
        sse({
          id: '1',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        }),
        'data: [DONE]\n\n'
      ],
      textRound('回显完毕')
    ]);

    const messages = await drain(service.stream(runOptions('回显一段长文')));

    // 参数完整之前就该出现带部分正文的预览卡片。
    const previews = messages.filter(
      (message): message is Extract<ChatMessage, { role: 'assistant' }> =>
        message.role === 'assistant' &&
        message.partial === true &&
        (message.toolCalls?.[0]?.arguments as { text?: string } | undefined)?.text !== undefined
    );

    expect(previews.length).toBeGreaterThan(0);
    const firstPreview = previews[0]!.toolCalls![0]!.arguments as { text: string };
    expect(firstPreview.text.length).toBeGreaterThan(0);
    // 预览是补齐出来的半截，短于最终值。
    expect(firstPreview.text.length).toBeLessThan(body.length);

    // 最终仍以权威解析值定稿。
    const settled = messages.filter(message => message.role === 'assistant' && message.partial === false);
    expect(JSON.stringify(settled)).toContain(body);
  });

  it('branchFromEntryId：切到历史节点重生成（新分支）', async () => {
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

  /**
   * 插话在 step 边界生效，不必等整条工具链跑完。
   *
   * 从前 steer 要等 runAgentLoop 跑完全部 step（最多 32）才被吸收：
   * 作者在 10 步工具链中途说"停，改看第三章"，得等那 10 步全跑完。
   */
  it('steer：工具链中途插话在下一步就生效', async () => {
    let releaseTool!: () => void;
    const toolGate = new Promise<void>(resolve => {
      releaseTool = resolve;
    });

    const fetchMock = vi.fn();
    // 首步：调用工具（工具执行被 gate 卡住，作者在此期间插话）。
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        sse({
          id: '1',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"text":"甲"}' } }
                ]
              }
            }
          ]
        }),
        sse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n'
      ])
    );
    fetchMock.mockResolvedValueOnce(sseResponse(textRound('好，改看第三章')));
    vi.stubGlobal('fetch', fetchMock);

    const slowTool: ToolDefinition = {
      ...echoTool,
      execute: async params => {
        await toolGate;
        return { text: `回显：${(params as { text: string }).text}` };
      }
    };

    service = new AgentService({
      sessionRepository: repository,
      modelService: {} as never,
      runtimeBundle: createBundle([slowTool]),
      gate: { check: async () => ({ outcome: 'allow-once' }) },
      compactSummarizer: stubSummarizer
    });

    const messages: ChatMessage[] = [];
    const iterator = service.stream(runOptions('读一下甲'));
    await iterator.next();

    // 工具还在跑的时候插话，再放行工具。
    await service.steer({ sessionId: 's1', query: '停，改看第三章', signal: abortController.signal });
    releaseTool();

    for (let message = await iterator.next(); !message.done; message = await iterator.next()) {
      messages.push(message.value);
    }

    // 第二步的请求体里，插话必须接在已结算的工具结果之后——模型这一步就能改道。
    const secondBody = String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? '');
    expect(secondBody).toContain('回显：甲');
    expect(secondBody).toContain('改看第三章');

    // 且插话必须真的落盘：否则重开会话时这句话就不见了。
    const persisted = await repository.getMessages('s1');
    expect(persisted.filter(message => message.role === 'user')).toHaveLength(2);
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
      compactSummarizer: stubSummarizer,
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

/** 消费整条流并收集消息。 */
async function drain(stream: AsyncGenerator<ChatMessage>) {
  const messages: ChatMessage[] = [];

  for await (const message of stream) {
    messages.push(message);
  }

  return messages;
}

/**
 * 自动压缩：设计文档的三触发里，manual 之外的两条。
 *
 * 阈值触发在开跑前折叠历史；溢出触发是撞墙后的自救。
 * 两者都只动"模型看到的上下文"——作者屏幕上的记录不会消失，
 * 压缩本身以 compaction entry 落进会话树，重开时在原位显示提示。
 */
describe('AgentService 自动压缩', () => {
  /** 窗口大小同时决定两条线：自动压缩阈值（90%）与保留近期预算（25%）。 */
  function modelWithWindow(contextWindow: number): ResolvedModel {
    return { ...createModel(), contextWindow };
  }

  /** 约 770 tokens 的历史：够触发阈值（窗口 200），也够折叠（窗口 2000 时保留预算 500）。 */
  async function seedLongSession() {
    await repository.openOrCreate('s1', '/workspace');
    const store = await repository.open('s1');

    for (let index = 0; index < 6; index += 1) {
      await store.appendMessage({ role: 'user', content: `第${index}问`.padEnd(60, '文') });
      await store.appendMessage({ role: 'assistant', content: `第${index}答`.padEnd(60, '文') });
    }
  }

  function serviceWith(options: { model: ResolvedModel; summarize?: CompactSummarizer }) {
    return new AgentService({
      sessionRepository: repository,
      modelService: {} as never,
      runtimeBundle: createBundle([echoTool], options.model),
      gate: { check: async () => ({ outcome: 'allow-once' }) },
      compactSummarizer: options.summarize ?? stubSummarizer
    });
  }

  it('水位过线时开跑前先折叠历史，摘要落进会话树', async () => {
    await seedLongSession();
    mockModelSequence([textRound('接着写')]);

    const summarize = vi.fn(stubSummarizer);
    const compacting = serviceWith({ model: modelWithWindow(200), summarize });

    await drain(compacting.stream(runOptions('继续')));

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0]?.[0]).toMatchObject({ reason: 'threshold' });

    // 压缩后的上下文以摘要开头，近期原文仍在（不是退化成"摘要 + 最后一条"）。
    const store = await repository.open('s1');
    const context = store.buildContextMessages();
    expect(JSON.stringify(context[0])).toContain('会话摘要');
    expect(context.length).toBeGreaterThan(2);
  });

  it('水位未过线时不压缩（预算说不必压就是不必压）', async () => {
    await repository.openOrCreate('s1', '/workspace');
    mockModelSequence([textRound('好的')]);

    const summarize = vi.fn(stubSummarizer);
    const compacting = serviceWith({ model: createModel(), summarize });

    await drain(compacting.stream(runOptions('随便聊聊')));

    expect(summarize).not.toHaveBeenCalled();
  });

  it('撞上上下文窗口时折叠后重跑本轮，而不是把失败抛给作者', async () => {
    await seedLongSession();

    const fetchMock = vi.fn();
    // 首次：provider 以上下文超限拒绝。
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens" } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    );
    fetchMock.mockResolvedValueOnce(sseResponse(textRound('压缩后重来一次')));
    vi.stubGlobal('fetch', fetchMock);

    const summarize = vi.fn(stubSummarizer);
    // 窗口 2000：历史够折（保留预算 500），但够不到 90% 线——
    // 阈值触发不会抢先，本例只验证撞墙自救这一条。
    const compacting = serviceWith({ model: modelWithWindow(2_000), summarize });

    const messages = await drain(compacting.stream(runOptions('继续写')));

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0]?.[0]).toMatchObject({ reason: 'overflow' });
    expect(JSON.stringify(messages)).toContain('压缩后重来一次');
  });

  it('压不动就照实报错，不假装恢复', async () => {
    await seedLongSession();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'maximum context length exceeded' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const compacting = serviceWith({
      model: modelWithWindow(2_000),
      summarize: async () => {
        throw new Error('蒸馏失败');
      }
    });

    await expect(drain(compacting.stream(runOptions('继续写')))).rejects.toThrow();
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
