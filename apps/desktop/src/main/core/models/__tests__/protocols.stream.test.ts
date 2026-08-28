import { jsonSchema, streamText, tool } from 'ai';
import { Type } from 'typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestBody, sseData as openaiSse, stubFetchOnce, stubSseFetch } from '../../../__tests__/helpers/sse';
import { createProtocolLanguageModel } from '../protocols';

/**
 * 真实 AI SDK 工厂 + mock fetch 的端到端网关验证：
 * SSE 字节进 → streamText 事件出，覆盖流式文本、tool-call、图像输入与错误码四类场景。
 * 此处验证的 SSE 形状即生产网关对接的真实协议。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openai-completions 网关端到端', () => {
  const source = {
    providerId: 'deepseek',
    api: 'openai-completions' as const,
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test'
  };

  it('流式文本：SSE delta → text 流', async () => {
    const fetchMock = stubSseFetch([
      openaiSse({ id: '1', choices: [{ index: 0, delta: { content: '你好' } }] }),
      openaiSse({ id: '1', choices: [{ index: 0, delta: { content: '，世界' } }] }),
      openaiSse({
        id: '1',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3 }
      }),
      'data: [DONE]\n\n'
    ]);

    const result = streamText({
      model: createProtocolLanguageModel(source, 'deepseek-chat'),
      messages: [{ role: 'user', content: '打招呼' }]
    });

    const text = await result.text;

    expect(text).toBe('你好，世界');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer sk-test' })
      })
    );
  });

  it('tool-call：SSE 工具调用 → toolCalls 完整聚合（引擎真实形状：带 TypeBox inputSchema）', async () => {
    // 注：分片 arguments（'"{"query":"' + '"雨夜}"'）的跨块聚合属 AI SDK 核心层职责，
    // 其时序在测试环境下不稳定；网关测试只背书透传与 schema 解析，故用单块全量形状
    //（DeepSeek/兼容站常见），跨块聚合留给引擎的 mock 模型测试覆盖。
    stubSseFetch([
      openaiSse({
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
                  function: { name: 'web_search', arguments: '{"query":"雨夜"}' }
                }
              ]
            }
          }
        ]
      }),
      openaiSse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n'
    ]);

    // 生产引擎永远带工具注册表；TypeBox 产物经 jsonSchema() 直通 AI SDK（零 zod import）。
    const result = streamText({
      model: createProtocolLanguageModel(source, 'deepseek-chat'),
      messages: [{ role: 'user', content: '搜索雨夜' }],
      tools: {
        web_search: tool({
          description: '搜索',
          inputSchema: jsonSchema(Type.Object({ query: Type.String() })),
          execute: async input => ({ results: [], echoed: input })
        })
      }
    });

    // response.messages 为 content parts 形状，tool-call 已聚合完整入参。
    const toolCall = (await result.response).messages
      .flatMap((message: { content?: unknown }) => (Array.isArray(message.content) ? message.content : []))
      .find((part: { type?: string }) => part.type === 'tool-call') as
      | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
      | undefined;

    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'web_search',
      input: { query: '雨夜' }
    });
  });

  it('图像输入：file part → 请求体 image_url base64', async () => {
    const fetchMock = stubSseFetch([
      openaiSse({ id: '1', choices: [{ index: 0, delta: { content: 'ok' } }] }),
      openaiSse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n'
    ]);

    const result = streamText({
      model: createProtocolLanguageModel(source, 'deepseek-chat'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张图是什么' },
            // AI SDK 的 ImagePart 已弃用；FilePart 的 data 为 base64 字符串（[1,2,3] → AQID）。
            { type: 'file', data: 'AQID', mediaType: 'image/png' }
          ]
        }
      ]
    });

    await result.text;

    const body = JSON.parse(requestBody(fetchMock, 0)) as {
      messages: { content: { type: string; image_url: { url: string } }[] }[];
    };

    const imagePart = body.messages[0]?.content.find(part => part.type === 'image_url');

    expect(imagePart?.image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('HTTP 401 → 结构化错误抛出', async () => {
    stubFetchOnce(
      () =>
        new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
    );

    const result = streamText({
      model: createProtocolLanguageModel(source, 'deepseek-chat'),
      messages: [{ role: 'user', content: 'hi' }]
    });

    await expect(result.text).rejects.toThrow();
  });
});

describe('anthropic-messages 网关端到端', () => {
  it('流式文本：Anthropic SSE 事件形状', async () => {
    const fetchMock = stubSseFetch([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-x","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"月亮"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"升起"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      // usage 必须带上：缺了它 AI SDK 的 message_delta 校验会失败并静默降级，
      // 用量归零而文本照常返回——费用与上下文水位两处同时失真。
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);

    const result = streamText({
      model: createProtocolLanguageModel(
        {
          providerId: 'anthropic',
          api: 'anthropic-messages',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant'
        },
        'claude-sonnet-4-20250514'
      ),
      messages: [{ role: 'user', content: '写一句夜景' }]
    });

    await expect(result.text).resolves.toBe('月亮升起');
    await expect(result.totalUsage).resolves.toMatchObject({ inputTokens: 1, outputTokens: 7 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'sk-ant' })
      })
    );
  });
});

/**
 * 推理档位在各协议上的落地形状。
 *
 * 用的是 AI SDK 的顶层 `reasoning`——一个可移植参数，由 SDK 自己翻译成各家的原生表达。
 * 断言写在**请求体**上而不是传给 streamText 的参数上：后者只能证明我们传了，
 * 证明不了对面收得到，而"四种协议都吃得下"正是选用顶层参数（而非自建映射）的前提。
 */
describe('推理档位的协议翻译', () => {
  const openaiCompatible = {
    providerId: 'deepseek',
    api: 'openai-completions' as const,
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test'
  };

  const openaiTextStep = [
    openaiSse({ id: '1', choices: [{ index: 0, delta: { content: 'ok' } }] }),
    openaiSse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n'
  ];

  it('openai 兼容协议：档位落成 reasoning_effort', async () => {
    const fetchMock = stubSseFetch(openaiTextStep);

    const result = streamText({
      model: createProtocolLanguageModel(openaiCompatible, 'deepseek-reasoner'),
      reasoning: 'high',
      messages: [{ role: 'user', content: '想一想' }]
    });

    await result.text;

    expect(JSON.parse(requestBody(fetchMock, 0))).toMatchObject({ reasoning_effort: 'high' });
  });

  it('不配档位时不发推理字段，交由服务端默认', async () => {
    const fetchMock = stubSseFetch(openaiTextStep);

    const result = streamText({
      model: createProtocolLanguageModel(openaiCompatible, 'deepseek-reasoner'),
      messages: [{ role: 'user', content: '想一想' }]
    });

    await result.text;

    expect(JSON.parse(requestBody(fetchMock, 0))).not.toHaveProperty('reasoning_effort');
  });

  it('anthropic 协议：同一个档位改落成 thinking 预算', async () => {
    const fetchMock = stubSseFetch([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-x","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);

    const result = streamText({
      model: createProtocolLanguageModel(
        {
          providerId: 'anthropic',
          api: 'anthropic-messages',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant'
        },
        'claude-sonnet-4-20250514'
      ),
      reasoning: 'high',
      messages: [{ role: 'user', content: '想一想' }]
    });

    await result.text;

    // 同一个枚举在这里不是枚举了：用 token 预算的 provider 由 SDK 按最大输出的百分比换算。
    // 断言只认"推理确实被打开了"，不钉死具体预算数字——那是 SDK 的换算细节，会随版本变。
    const body = JSON.parse(requestBody(fetchMock, 0)) as { thinking?: { type?: string } };

    expect(body.thinking?.type).toBeDefined();
  });
});
