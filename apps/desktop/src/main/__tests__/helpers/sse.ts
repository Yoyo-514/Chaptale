import { vi } from 'vitest';

/**
 * SSE / fetch 桩：走真实 AI SDK 管线的测试都在 fetch 这一层注入。
 *
 * 引擎验收与协议网关验收原本各自维护一份同名夹具，形态还不一致——
 * 其中一份踩过下面注释里那个坑，另一份没有。集中一处后两边同时受保护。
 */

/** 无状态，三种流形态共用。 */
const encoder = new TextEncoder();

/** event-stream 响应的固定头；分块怎么进流由各夹具自己决定。 */
const EVENT_STREAM_INIT = { status: 200, headers: { 'content-type': 'text/event-stream' } } as const;

/** 把分块拼成一个 text/event-stream 响应。 */
export function sseResponse(chunks: string[], init?: ResponseInit): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      }
    }),
    {
      ...EVENT_STREAM_INIT,
      headers: { ...EVENT_STREAM_INIT.headers, ...init?.headers },
      ...init
    }
  );
}

/** OpenAI 兼容协议的 data 行包装。 */
export const sseData = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

/**
 * 按步桩掉 fetch：每个入参是一步的 SSE 分块，逐步惰性构造 Response。
 *
 * 只收分块数组、不收现成的 Response，是为了让一类夹具错误无法写出来：
 * Response 的 body 是一次性流，把同一个实例交给第二次调用时读到空流，
 * `finish_reason` 随之丢失——症状看着像引擎认不出截断，实则与实现无关。
 * 步数耗尽后再请求即抛错，"引擎多发了一轮"不会退化成静默的空响应。
 */
export function stubSseFetch(...steps: string[][]) {
  const fetchMock = vi.fn(async (): Promise<Response> => {
    throw new Error('fetch 调用次数超出夹具预设的步数');
  });

  for (const chunks of steps) {
    fetchMock.mockImplementationOnce(async () => sseResponse(chunks));
  }

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

/** 同一步无限重复（跑到护栏截停的场景，步数由被测逻辑决定）。 */
export function stubRepeatingSseFetch(chunks: string[]) {
  const fetchMock = vi.fn(async () => sseResponse(chunks));
  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

/** 单次非流式响应（错误码等）；同样惰性构造。 */
export function stubFetchOnce(build: () => Response) {
  const fetchMock = vi.fn(async () => build());
  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

/**
 * 吐完给定分块后既不再吐也不 close：provider 接下了连接却不再返回内容。
 *
 * 流永远不结束，所以被测逻辑必须自己诊断静默。少了那道诊断，用例会一直挂到
 * vitest 判超时——不会退化成一次静默通过。
 */
export function stubStallingSseFetch(chunks: string[]) {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(chunk));
            }
          }
        }),
        EVENT_STREAM_INIT
      )
  );

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

/** 每隔 gapMs 推一块：慢而不断的流，用来钉住空闲超时不误杀长思考。 */
export function stubPacedSseFetch(chunks: string[], gapMs: number) {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const chunk of chunks) {
              await new Promise(resolve => setTimeout(resolve, gapMs));
              controller.enqueue(encoder.encode(chunk));
            }

            controller.close();
          }
        }),
        EVENT_STREAM_INIT
      )
  );

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

/** fetch 桩的最小只读形状：断言只用到调用记录。 */
type FetchCallRecorder = { mock: { calls: unknown[][] } };

/** 取第 index 次请求的 body 字符串。 */
export function requestBody(fetchMock: FetchCallRecorder, index: number): string {
  const call = fetchMock.mock.calls[index];

  return String((call?.[1] as RequestInit | undefined)?.body ?? '');
}
