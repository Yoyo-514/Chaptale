export type StubCall = { url: string; method: string; body: string; headers: Record<string, string> };

/**
 * 注入的 fetch：记录请求、回放固定报文。
 *
 * 它**不替代被测函数**——测的就是适配器自己怎么发请求、怎么解响应；
 * 夹具在两份适配器测试之间共用，免得一边改了请求形状、另一边还在按老样子断言。
 */
export function createStubFetch(replies: Array<Response | unknown>) {
  const calls: StubCall[] = [];
  let index = 0;

  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);

    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body:
        typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '',
      headers: Object.fromEntries(headers.entries())
    });

    const reply = replies[index++];

    if (reply === undefined) {
      throw new Error(`未预期的第 ${index} 次请求：${String(input)}`);
    }

    return reply instanceof Response ? reply : new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof globalThis.fetch;

  return { calls, send };
}
