import { Type } from 'typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProtocolLanguageModel } from '../../models/protocols';
import type { ResolvedModel } from '../../models/runtime';
import type { SessionMessage } from '../../sessions/entry';
import type { ToolDefinition } from '../../tool-protocol/definition';
import { runAgentLoop, withSyntheticResults } from '../engine';
import type { PermissionGatePort } from '../types';

/**
 * 引擎验收：mock SSE → streamText → 事件透传 / step 落盘 / 闸门 / 多步工具链。
 * 复用 P2-b 验证过的真实 AI SDK 工厂管线。
 */

afterEach(() => {
  vi.unstubAllGlobals();
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

const openaiTextStep = (text: string, finish = 'stop') => [
  sse({ id: '1', choices: [{ index: 0, delta: { content: text } }] }),
  sse({
    id: '1',
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  }),
  'data: [DONE]\n\n'
];

const openaiToolStep = () => [
  sse({
    id: '1',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a.txt"}' } }
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
];

function createModel() {
  return {
    model: createProtocolLanguageModel(
      { providerId: 'test', api: 'openai-completions', baseUrl: 'https://test.local/v1', apiKey: 'k' },
      'test-model'
    ),
    provider: 'test',
    modelId: 'test-model',
    contextWindow: 128_000,
    input: ['text'] as const,
    maxTokens: undefined
  } satisfies ResolvedModel;
}

const readTool: ToolDefinition = {
  name: 'read',
  label: '读取',
  description: '读文件',
  riskLevel: 'readonly',
  parameters: Type.Object({ path: Type.String() }, { additionalProperties: false }),
  execute: async params => ({ text: `内容 of ${(params as { path: string }).path}` })
};

const writeTool: ToolDefinition = {
  name: 'write',
  label: '写入',
  description: '写文件',
  riskLevel: 'mutating',
  parameters: Type.Object({ path: Type.String(), content: Type.String() }, { additionalProperties: false }),
  execute: async params => ({ text: `已写入 ${(params as { path: string }).path}` })
};

describe('runAgentLoop', () => {
  it('单步文本：事件透传序列 + step 落盘（含 usage）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(openaiTextStep('你好，世界'))));

    const persisted: SessionMessage[][] = [];
    const envelopes: { seq: number; type: string }[] = [];

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '打招呼' }],
      tools: [readTool],
      onPart: envelope => {
        envelopes.push({ seq: envelope.seq, type: (envelope.part as { type: string }).type });
      },
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    expect(result.finishReason).toBe('stop');
    expect(result.totalUsage.totalTokens).toBeGreaterThan(0);
    expect(result.aborted).toBe(false);

    // 信封：sessionId + 递增 seq + part 原样透传。
    expect(envelopes.every((item, index) => item.seq === index)).toBe(true);
    expect(envelopes.map(item => item.type)).toEqual(expect.arrayContaining(['text-delta', 'finish-step', 'finish']));

    // 落盘：assistant 消息带文本与 usage。
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toHaveLength(1);
    expect(persisted[0]?.[0]).toMatchObject({ role: 'assistant', content: '你好，世界' });
    expect(persisted[0]?.[0]).toHaveProperty('usage');
  });

  it('两步工具链：tool-call → 执行 → 续答；assistant/tool 两组消息各自落盘', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(openaiToolStep()))
      .mockResolvedValueOnce(sseResponse(openaiTextStep('文件内容已读取完毕')));
    vi.stubGlobal('fetch', fetchMock);

    const persisted: SessionMessage[][] = [];

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool],
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    // 第一步：assistant（含 toolCalls）。
    const step1 = persisted[0] ?? [];
    expect(step1[0]).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'call_1', name: 'read', arguments: { path: 'a.txt' } }]
    });

    // 第二步：assistant 最终文本。
    const step2 = persisted[1] ?? [];
    expect(step2[0]).toMatchObject({ role: 'assistant', content: '文件内容已读取完毕' });

    // 两轮模型请求（工具结果回传后续答）。
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mutating 工具走闸门：allow 后执行', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          sse({
            id: '1',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'write', arguments: '{"path":"b.txt","content":"x"}' }
                    }
                  ]
                }
              }
            ]
          }),
          sse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n'
        ])
      )
      .mockResolvedValueOnce(sseResponse(openaiTextStep('写入完成')));
    vi.stubGlobal('fetch', fetchMock);

    const gate: PermissionGatePort = { check: vi.fn().mockResolvedValue({ outcome: 'allow-once' }) };
    const persisted: SessionMessage[][] = [];

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '写 b.txt' }],
      tools: [writeTool],
      gate,
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    expect(gate.check).toHaveBeenCalledWith({
      sessionId: 's1',
      toolName: 'write',
      riskLevel: 'mutating',
      args: { path: 'b.txt', content: 'x' }
    });
  });

  it('gate deny：拒绝载荷对模型可见，工具不执行', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          sse({
            id: '1',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'write', arguments: '{"path":"b.txt","content":"x"}' }
                    }
                  ]
                }
              }
            ]
          }),
          sse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n'
        ])
      )
      .mockResolvedValueOnce(sseResponse(openaiTextStep('好的，我不写了')));
    vi.stubGlobal('fetch', fetchMock);

    const executeSpy = vi.fn(writeTool.execute);
    const gate: PermissionGatePort = {
      check: vi.fn().mockResolvedValue({ outcome: 'deny', reason: '测试拒绝' })
    };

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '写 b.txt' }],
      tools: [{ ...writeTool, execute: executeSpy }],
      gate
    });

    expect(executeSpy).not.toHaveBeenCalled();
    // 第二轮请求体含拒绝结果（模型可见）。
    const secondBody = JSON.parse(
      String(
        (fetchMock.mock.calls[1] as unknown[])[1] && ((fetchMock.mock.calls[1] as unknown[])[1] as RequestInit).body
      )
    ) as { messages: unknown[] };
    const bodyText = JSON.stringify(secondBody);
    expect(bodyText).toContain('测试拒绝');
  });

  it('abort 中断：aborted 置位、已收集内容尽力落盘', async () => {
    // 慢流：首块后挂起，模拟用户中断。
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
            controller.enqueue(encoder.encode(sse({ id: '1', choices: [{ index: 0, delta: { content: '部分' } }] })));
            void gated.then(() => controller.close());
          }
        });

        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      })
    );

    const abortController = new AbortController();
    const persisted: SessionMessage[][] = [];

    const loopPromise = runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '长文' }],
      tools: [],
      abortSignal: abortController.signal,
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    abortController.abort();
    releaseStream();

    const result = await loopPromise;

    expect(result.aborted).toBe(true);
  });

  it('readonly 工具不过闸门', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          sseResponse([
            sse({
              id: '1',
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'read', arguments: '{"path":"a.txt"}' }
                      }
                    ]
                  }
                }
              ]
            }),
            sse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
            'data: [DONE]\n\n'
          ])
        )
        .mockResolvedValueOnce(sseResponse(openaiTextStep('完成')))
    );

    const gate: PermissionGatePort = { check: vi.fn().mockResolvedValue({ outcome: 'allow-once' }) };

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool],
      gate
    });

    expect(gate.check).not.toHaveBeenCalled();
  });
});

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number): string {
  const call = fetchMock.mock.calls[index] as unknown[] | undefined;
  return String((call?.[1] as RequestInit | undefined)?.body ?? '');
}

/**
 * 取请求体里的 tool 角色消息。
 *
 * provider 的 `switch (output.type)` 没有 default 分支，未归一化的 output 会让
 * content 整个消失（键不存在）而不是变成空串——只断言整体字符串包含正文抓不住这条。
 */
function toolMessagesOf(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const body = JSON.parse(requestBody(fetchMock, index)) as {
    messages: { role: string; content?: unknown }[];
  };

  return body.messages.filter(message => message.role === 'tool');
}

/**
 * 错误路径验收。
 *
 * 这一组对应「运行时没有错误路径」那两条 P0：AI SDK 把失败编码成 `error` /
 * `tool-error` 两类流事件而不是抛异常，只实现 happy path 的消费者会静默失效。
 * 每条都钉住一个曾经真实发生的失败模式。
 */
describe('runAgentLoop 错误路径', () => {
  const throwingTool: ToolDefinition = {
    ...readTool,
    execute: async () => {
      throw new Error('文件不存在：ghost.txt');
    }
  };

  it('工具抛错：落盘 assistant 与 tool 必须配对，且带 isError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(openaiToolStep()))
      .mockResolvedValueOnce(sseResponse(openaiTextStep('那我换个思路')));
    vi.stubGlobal('fetch', fetchMock);

    const persisted: SessionMessage[][] = [];

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 ghost.txt' }],
      tools: [throwingTool],
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    const step1 = persisted[0] ?? [];
    expect(step1[0]).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'call_1' }] });
    expect(step1[1]).toMatchObject({ role: 'tool', toolCallId: 'call_1', isError: true });
    expect(String((step1[1] as { output: unknown }).output)).toContain('ghost.txt');
  });

  it('落盘产物重建上下文后必须能再次发起请求（悬空 tool_call 会让会话永久失效）', async () => {
    const firstFetch = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(openaiToolStep()))
      .mockResolvedValueOnce(sseResponse(openaiTextStep('好的')));
    vi.stubGlobal('fetch', firstFetch);

    const persisted: SessionMessage[][] = [];

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 ghost.txt' }],
      tools: [throwingTool],
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    // 第二次使用该会话：把落盘产物当历史喂回去（等价于关掉重开再发一条）。
    const replayed: SessionMessage[] = [
      { role: 'user', content: '读 ghost.txt' },
      ...persisted.flat(),
      { role: 'user', content: '那算了，直接写吧' }
    ];

    const secondFetch = vi.fn().mockResolvedValue(sseResponse(openaiTextStep('这就写')));
    vi.stubGlobal('fetch', secondFetch);

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: replayed,
      tools: [throwingTool]
    });

    // 修复前这里是 0 次请求、finishReason 'unknown'、且不抛异常——静默失效的全部特征。
    expect(secondFetch).toHaveBeenCalledTimes(1);
    expect(result.finishReason).toBe('stop');

    // 且工具结果正文必须真的抵达 provider：落盘存的是 execute 原始返回值，
    // 转模型消息时若不归一化成标签联合，provider 侧 content 会整个消失。
    const toolMessages = toolMessagesOf(secondFetch, 0);
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]?.content).toContain('ghost.txt');
  });

  it('成功的工具结果同样要能回放（normalize 后模型看得到正文）', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(sseResponse(openaiToolStep()))
        .mockResolvedValueOnce(sseResponse(openaiTextStep('读完了')))
    );

    const persisted: SessionMessage[][] = [];

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool],
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    const secondFetch = vi.fn().mockResolvedValue(sseResponse(openaiTextStep('继续')));
    vi.stubGlobal('fetch', secondFetch);

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }, ...persisted.flat(), { role: 'user', content: '总结一下' }],
      tools: [readTool]
    });

    expect(requestBody(secondFetch, 0)).toContain('内容 of a.txt');
  });
  it('provider 错误必须以异常抵达调用方，而不是报告成功', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    await expect(
      runAgentLoop({
        sessionId: 's1',
        model: createModel(),
        system: '你是助手',
        messages: [{ role: 'user', content: '你好' }],
        tools: []
      })
    ).rejects.toThrow();
  });

  it('非法工具参数不得进入 execute，且会话仍可继续', async () => {
    const executeSpy = vi.fn(readTool.execute);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          sse({
            id: '1',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      // schema 要求 { path: string } 且 additionalProperties: false。
                      function: { name: 'read', arguments: '{"wrong_key":123}' }
                    }
                  ]
                }
              }
            ]
          }),
          sse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n'
        ])
      )
      .mockResolvedValueOnce(sseResponse(openaiTextStep('抱歉，我用错了参数')));
    vi.stubGlobal('fetch', fetchMock);

    const persisted: SessionMessage[][] = [];

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读点什么' }],
      tools: [{ ...readTool, execute: executeSpy }],
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    // 修复前：工具照常执行，内部拿到 undefined。
    expect(executeSpy).not.toHaveBeenCalled();

    // 诊断必须对模型可见，且落盘配对——否则这一步反而成了新的会话杀手。
    const result = persisted[0]?.[1] as { role: string; output: unknown; isError?: boolean } | undefined;
    expect(result).toMatchObject({ role: 'tool', isError: true });
    expect(String(result?.output)).toContain('wrong_key');
    expect(requestBody(fetchMock, 1)).toContain('wrong_key');
  });

  it('取消不算失败：aborted 置位且不抛异常', async () => {
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
            controller.enqueue(encoder.encode(sse({ id: '1', choices: [{ index: 0, delta: { content: '部分' } }] })));
            void gated.then(() => controller.close());
          }
        });

        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      })
    );

    const abortController = new AbortController();
    const loopPromise = runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '长文' }],
      tools: [],
      abortSignal: abortController.signal
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    abortController.abort();
    releaseStream();

    await expect(loopPromise).resolves.toMatchObject({ aborted: true });
  });
});

describe('withSyntheticResults', () => {
  it('全部已结算时恒等（正常 step 不受影响）', () => {
    const calls = [{ id: 'call_1', name: 'read' }];
    const results = [{ toolCallId: 'call_1', toolName: 'read', output: { text: 'ok' }, isError: false }];

    expect(withSyntheticResults(calls, results)).toBe(results);
  });

  it('中断留下的未结算调用补合成结果，已有结果保持不变', () => {
    const calls = [
      { id: 'call_1', name: 'write' },
      { id: 'call_2', name: 'write' }
    ];
    const results = [{ toolCallId: 'call_1', toolName: 'write', output: { text: '已写入' }, isError: false }];

    const merged = withSyntheticResults(calls, results);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(results[0]);
    expect(merged[1]).toMatchObject({ toolCallId: 'call_2', isError: true });
  });
});
