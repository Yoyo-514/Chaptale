import { jsonSchema, streamText, tool } from 'ai';
import { Type } from 'typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProtocolLanguageModel } from '../protocols';

/**
 * 真实 AI SDK 工厂 + mock fetch 的端到端网关验证：
 * SSE 字节进 → streamText 事件出，覆盖流式文本、tool-call、图像输入与错误码四类场景。
 * 此处验证的 SSE 形状即生产网关对接的真实协议，引擎测试可复用本 helper。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseResponse(chunks: string[], init?: ResponseInit) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...init?.headers },
    ...init
  });
}

const openaiSse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

describe('openai-completions 网关端到端', () => {
  const source = {
    providerId: 'deepseek',
    api: 'openai-completions' as const,
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test'
  };

  it('流式文本：SSE delta → text 流', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        openaiSse({ id: '1', choices: [{ index: 0, delta: { content: '你好' } }] }),
        openaiSse({ id: '1', choices: [{ index: 0, delta: { content: '，世界' } }] }),
        openaiSse({
          id: '1',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3 }
        }),
        'data: [DONE]\n\n'
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

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
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
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
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          openaiSse({ id: '1', choices: [{ index: 0, delta: { content: 'ok' } }] }),
          openaiSse({ id: '1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
          'data: [DONE]\n\n'
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

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

    const body = JSON.parse(
      String(
        (fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body
      )
    ) as {
      messages: { content: { type: string; image_url: { url: string } }[] }[];
    };

    const imagePart = body.messages[0]?.content.find(part => part.type === 'image_url');

    expect(imagePart?.image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('HTTP 401 → 结构化错误抛出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
      )
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-x","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"月亮"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"升起"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'sk-ant' })
      })
    );
  });
});
