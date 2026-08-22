import { Type } from 'typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  requestBody,
  sseData as sse,
  stubFetchOnce,
  stubRepeatingSseFetch,
  stubSseFetch
} from '../../../__tests__/helpers/sse';
import { estimateTextTokens } from '../../context/token-counter';
import { createProtocolLanguageModel } from '../../models/protocols';
import type { ResolvedModel } from '../../models/runtime';
import type { SessionMessage } from '../../sessions/entry';
import type { ToolDefinition } from '../../tool-protocol/definition';
import { runAgentLoop, withSyntheticResults } from '../engine';
import type { PermissionGatePort } from '../types';

/**
 * 引擎验收：mock SSE → streamText → 事件透传 / step 落盘 / 闸门 / 多步工具链。
 * 走真实 AI SDK 工厂管线，不桩掉 provider 适配层。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

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

function createModel(modelId = 'test-model') {
  return {
    model: createProtocolLanguageModel(
      { providerId: 'test', api: 'openai-completions', baseUrl: 'https://test.local/v1', apiKey: 'k' },
      modelId
    ),
    provider: 'test',
    modelId,
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
    stubSseFetch(openaiTextStep('你好，世界'));

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
    expect(result.stopReason).toBe('natural');
    expect(result.steps).toBe(1);
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
    const fetchMock = stubSseFetch(openaiToolStep(), openaiTextStep('文件内容已读取完毕'));

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
    stubSseFetch(
      [
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
      ],
      openaiTextStep('写入完成')
    );

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
    const fetchMock = stubSseFetch(
      [
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
      ],
      openaiTextStep('好的，我不写了')
    );

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
    stubSseFetch(
      [
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
      ],
      openaiTextStep('完成')
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

  it('超大工具输出：单轮内模型通道截断且 details 不进上下文，落盘保留原始完整值', async () => {
    const hugeText = `开头证据-${'中'.repeat(10_000)}-结尾证据`;
    const hugeReadTool: ToolDefinition = {
      ...readTool,
      execute: async () => ({ text: hugeText, details: { markdown: hugeText } })
    };

    const fetchMock = stubSseFetch(openaiToolStep(), openaiTextStep('已读完'));

    const persisted: SessionMessage[][] = [];

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [hugeReadTool],
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    // 落盘：execute 原始返回值原样保留（UI 与历史导出可读全文）。
    const step1 = persisted[0] ?? [];
    expect(step1[1]).toMatchObject({ role: 'tool', output: { text: hugeText, details: { markdown: hugeText } } });

    // 第二轮请求：模型只拿到预算内的 text 窗口，details 不进上下文。
    const toolMessages = toolMessagesOf(fetchMock, 1);
    expect(toolMessages).toHaveLength(1);
    const modelContent = String(toolMessages[0]?.content ?? '');
    expect(modelContent).toContain('工具输出超出预算');
    expect(modelContent).toContain('开头证据');
    expect(modelContent).toContain('结尾证据');
    expect(modelContent).not.toContain('markdown');
    expect(estimateTextTokens(modelContent)).toBeLessThanOrEqual(8_000);
  });

  it('maxSteps 覆盖生效：到达上限即停，不再发起下一轮请求', async () => {
    const fetchMock = stubSseFetch(openaiToolStep(), openaiTextStep('不该被请求'));

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool],
      maxSteps: 1
    });

    // 第一步工具结算后达到上限：不再发起第二轮请求。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.finishReason).toBe('tool-calls');
    // 护栏截停必须可辨认：finishReason 只说"模型想调工具"，说不出"是引擎不让它继续"。
    expect(result.stopReason).toBe('step-limit');
  });

  it('token 预算停止：累计 usage 触顶即停（成本护栏）', async () => {
    const fetchMock = stubSseFetch(openaiToolStep(), openaiToolStep(), openaiTextStep('不该被请求'));

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool],
      maxSteps: 10,
      // 每步 usage 为 15（prompt 10 + completion 5）：第二步后累计 30 触顶，
      // 第三步的文本响应不应被请求。
      maxTotalTokens: 25
    });

    // 自然结束必以文本步收尾；停在 'tool-calls' 即护栏截停的信号。
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.finishReason).toBe('tool-calls');
    expect(result.stopReason).toBe('token-budget');
  });

  /**
   * 会话推进必须用 SDK 自己的响应消息，不能改用落盘投影。
   *
   * 落盘有意丢弃 reasoning（它不进历史回放），而带思维链的模型在工具轮里
   * 需要原样收回自己的推理块——Anthropic 扩展思考更是要连签名一起回传，缺了直接报错。
   * 用落盘投影推进会话在普通模型上看不出问题，只在 reasoning 模型上炸。
   */
  it('推理块随会话推进回传给下一步（落盘投影会把它丢掉）', async () => {
    const fetchMock = stubSseFetch(
      [
        sse({ id: '1', choices: [{ index: 0, delta: { reasoning_content: '先读文件再判断' } }] }),
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
      ],
      openaiTextStep('读完了')
    );

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool]
    });

    // openai-compatible 协议把推理块回写成 reasoning_content。
    expect(requestBody(fetchMock, 1)).toContain('先读文件再判断');
  });
});

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
 * AI SDK 把失败编码成 `error` / `tool-error` 两类流事件而不是抛异常，
 * 只实现 happy path 的消费者会静默失效。每条都钉住一个真实的失败模式。
 */
describe('runAgentLoop 错误路径', () => {
  const throwingTool: ToolDefinition = {
    ...readTool,
    execute: async () => {
      throw new Error('文件不存在：ghost.txt');
    }
  };

  it('工具抛错：落盘 assistant 与 tool 必须配对，且带 isError', async () => {
    stubSseFetch(openaiToolStep(), openaiTextStep('那我换个思路'));

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
    stubSseFetch(openaiToolStep(), openaiTextStep('好的'));

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

    const secondFetch = stubSseFetch(openaiTextStep('这就写'));

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
    stubSseFetch(openaiToolStep(), openaiTextStep('读完了'));

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

    const secondFetch = stubSseFetch(openaiTextStep('继续'));

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
    stubFetchOnce(
      () =>
        new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
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
    const fetchMock = stubSseFetch(
      [
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
      ],
      openaiTextStep('抱歉，我用错了参数')
    );

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

  /**
   * 输出撞 token 上限：批次里被截断的那个调用由 SDK 判非法，
   * 其余调用参数完整、照常会执行——于是"写两章"变成只写了第一章，
   * 而这恰恰是多文件协调改写最不能接受的中间态。
   */
  it('输出被截断时整批工具调用都不执行，且各自留下配对结果', async () => {
    const executeSpy = vi.fn(writeTool.execute);
    const fetchMock = stubRepeatingSseFetch([
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
                  function: { name: 'write', arguments: '{"path":"第一章.md","content":"完整的第一章正文"}' }
                },
                {
                  index: 1,
                  id: 'call_2',
                  type: 'function',
                  // 参数 JSON 在此被 token 上限砍断。
                  function: { name: 'write', arguments: '{"path":"第二章.md","con' }
                }
              ]
            }
          }
        ]
      }),
      sse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }),
      'data: [DONE]\n\n'
    ]);

    const persisted: SessionMessage[][] = [];

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '写第一章和第二章' }],
      tools: [{ ...writeTool, execute: executeSpy }],
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    expect(result.aborted).toBe(false);
    // 判定取单次模型调用的原始停止原因；流上的聚合值在这个场景里是 'other'，认不出截断。
    expect(result.finishReason).toBe('length');
    // 首次作废后给了一次重发机会，模型又撞了一次上限，这才停。
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.stopReason).toBe('output-truncated');
    // 修复前：参数完整的 call_1 会写入，只有被截断的 call_2 报错。
    expect(executeSpy).not.toHaveBeenCalled();

    // 两个调用都要留下配对结果，否则本条修复反而制造悬空。
    const step = persisted[0] ?? [];
    const outputs = new Map(
      step
        .filter(message => message.role === 'tool')
        .map(message => [
          (message as { toolCallId: string }).toolCallId,
          message as { output: unknown; isError?: boolean }
        ])
    );

    expect([...outputs.keys()].toSorted()).toEqual(['call_1', 'call_2']);
    expect([...outputs.values()].every(entry => entry.isError === true)).toBe(true);
    // 参数完整的那个是被本次修复挡下的；被截断的那个由 SDK 判非法。
    expect(String(outputs.get('call_1')?.output)).toContain('整体作废');
    expect(String(outputs.get('call_2')?.output)).toContain('JSON');
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

/**
 * step 边界干预点。
 *
 * 把循环收回引擎，换来的就是这个原本不存在的时点：上一步已结算、下一步未发出。
 * 作者中途插话、截断后自纠、按步换配置，全都落在这里。
 */
describe('runAgentLoop prepareStep', () => {
  it('截断作废后给一次重发机会，模型改小即可继续', async () => {
    const executeSpy = vi.fn(writeTool.execute);
    stubSseFetch(
      // 第一步：两个调用，第二个被 token 上限砍断 → 整批作废。
      [
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
                    function: { name: 'write', arguments: '{"path":"第一章.md","content":"正文"}' }
                  },
                  {
                    index: 1,
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'write', arguments: '{"path":"第二' }
                  }
                ]
              }
            }
          ]
        }),
        sse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }),
        'data: [DONE]\n\n'
      ],
      // 第二步：模型照提示拆小，只发一个完整调用。
      [
        sse({
          id: '1',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_3',
                    type: 'function',
                    function: { name: 'write', arguments: '{"path":"第一章.md","content":"正文"}' }
                  }
                ]
              }
            }
          ]
        }),
        sse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n'
      ],
      openaiTextStep('第一章写好了')
    );

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '写第一章和第二章' }],
      tools: [{ ...writeTool, execute: executeSpy }]
    });

    // 作废那一批一个都没执行，重发的那一个正常执行——作者不必再说一句"继续"。
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('natural');
  });

  it('作者中途插话在 step 边界生效，不必等整条工具链跑完', async () => {
    const fetchMock = stubSseFetch(openaiToolStep(), openaiTextStep('好，改看第三章'));

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool],
      // 作者在第 0 步跑动时打字，第 1 步开始前才拿到。
      prepareStep: async context =>
        context.stepIndex === 1
          ? { appendMessages: [{ role: 'user', content: '停，改看第三章' }], resume: true }
          : undefined
    });

    // 第 0 步发出时还没有插话。
    expect(requestBody(fetchMock, 0)).not.toContain('改看第三章');
    // 插话必须接在已结算的工具结果之后：第 1 步的请求体里两者都在。
    const body = requestBody(fetchMock, 1);
    expect(body).toContain('内容 of a.txt');
    expect(body).toContain('改看第三章');
    expect(result.stopReason).toBe('natural');
  });

  it('插话可以推翻"模型已收尾"的停止决定', async () => {
    const fetchMock = stubSseFetch(openaiTextStep('说完了'), openaiTextStep('那再补一点'));

    const seen: (string | undefined)[] = [];
    let injected = false;

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '说点什么' }],
      tools: [],
      prepareStep: async context => {
        seen.push(context.pendingStop);

        if (context.pendingStop !== 'natural' || injected) {
          return undefined;
        }

        injected = true;
        return { appendMessages: [{ role: 'user', content: '再补一点' }], resume: true };
      }
    });

    // 第二次调用时引擎已打算按 natural 收尾，插话把它接了下去；第三次没人再干预，才真的停。
    expect(seen).toEqual([undefined, 'natural', 'natural']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('护栏截停不被插话推翻（resume 只对 natural 有意义时由调用方把关）', async () => {
    stubRepeatingSseFetch(openaiToolStep());

    const seen: (string | undefined)[] = [];

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool],
      maxTotalTokens: 25,
      prepareStep: async context => {
        seen.push(context.pendingStop);
        // 调用方看到护栏截停就不干预。
        return undefined;
      }
    });

    expect(seen.at(-1)).toBe('token-budget');
    expect(result.stopReason).toBe('token-budget');
  });

  it('按步覆盖模型与工具集', async () => {
    const fetchMock = stubSseFetch(openaiToolStep(), openaiTextStep('换模型收尾'));

    const finisher = createModel('finisher-model');

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [readTool],
      prepareStep: async context =>
        context.stepIndex === 0 ? undefined : { model: finisher, system: '收尾时只做总结', tools: [] }
    });

    const body = JSON.parse(requestBody(fetchMock, 1)) as { model: string; tools?: unknown[] };
    expect(body.model).toBe('finisher-model');
    expect(body.tools ?? []).toHaveLength(0);
  });
});

/**
 * 工具级超时。
 *
 * 没有这道闸时，一个再也不返回的工具会把整轮停在那里，作者只能手动点停止。
 */
describe('runAgentLoop 工具超时', () => {
  it('超时以失败结果收尾，会话可继续', async () => {
    const hungTool: ToolDefinition = {
      ...readTool,
      timeoutMs: 20,
      execute: () => new Promise(() => {})
    };

    stubSseFetch(openaiToolStep(), openaiTextStep('那我换个办法'));

    const persisted: SessionMessage[][] = [];

    const result = await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [hungTool],
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    // 超时不是终止：模型拿到"这个工具没回来"后自己改道。
    expect(result.stopReason).toBe('natural');
    const toolMessage = (persisted[0] ?? [])[1] as { output: unknown; isError?: boolean } | undefined;
    expect(toolMessage).toMatchObject({ isError: true });
    expect(String(toolMessage?.output)).toContain('仍未返回');
  });

  it('工具收得到超时信号，可以就地停手', async () => {
    let observed: AbortSignal | undefined;
    const observingTool: ToolDefinition = {
      ...readTool,
      timeoutMs: 20,
      execute: (_params, signal) => {
        observed = signal;
        return new Promise(() => {});
      }
    };

    stubSseFetch(openaiToolStep(), openaiTextStep('好'));

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '读 a.txt' }],
      tools: [observingTool]
    });

    expect(observed?.aborted).toBe(true);
  });

  /**
   * 闸门等的是人。把授权等待算进工具超时，会让"作者去倒杯水"变成一次工具失败——
   * 所以超时只罩住 execute，不罩闸门。
   */
  it('闸门等待不计入工具超时', async () => {
    const executed = vi.fn(async () => ({ text: '已写入' }));
    const slowGate: PermissionGatePort = {
      check: async () => {
        await new Promise(resolve => setTimeout(resolve, 60));
        return { outcome: 'allow-once' };
      }
    };

    stubSseFetch(
      [
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
      ],
      openaiTextStep('写好了')
    );

    const persisted: SessionMessage[][] = [];

    await runAgentLoop({
      sessionId: 's1',
      model: createModel(),
      system: '你是助手',
      messages: [{ role: 'user', content: '写 b.txt' }],
      // 授权等待（60ms）远长于工具超时（30ms），但两者不该叠加。
      tools: [{ ...writeTool, timeoutMs: 30, execute: executed }],
      gate: slowGate,
      onStepPersist: async messages => {
        persisted.push(messages);
      }
    });

    expect(executed).toHaveBeenCalledTimes(1);
    expect((persisted[0] ?? [])[1]).not.toHaveProperty('isError');
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
