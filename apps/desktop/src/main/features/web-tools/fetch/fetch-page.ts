import { SsrfError, assertFetchableUrl } from './ssrf-guard';

export type FetchedPage = {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
};

export type FetchPageOptions = {
  timeoutSeconds: number;
  maxBytes: number;
  allowRanges: readonly string[];
  /** 外部取消（如用户中断）；与超时信号合并。 */
  signal?: AbortSignal;
};

const MAX_REDIRECTS = 5;
const ALLOWED_CONTENT_TYPES = new Set(['text/html', 'text/plain', 'application/json', 'application/xml', 'text/xml']);
const UA = 'Mozilla/5.0 (compatible; ChaptaleWebTools/1.0)';

export type FetchClient = {
  fetch?: typeof globalThis.fetch;
};

/**
 * 抓取页面：手动跟随重定向（每跳重过 SSRF 校验）、限制体积并按 Content-Type 白名单过滤。
 *
 * 返回正文为 UTF-8 文本；体积超限时截断并标记 truncated。
 */
export async function fetchPage(url: string, client: FetchClient, options: FetchPageOptions): Promise<FetchedPage> {
  const doFetch = client.fetch ?? globalThis.fetch;
  let current = await assertFetchableUrl(url, { allowRanges: options.allowRanges });

  // 上限写在循环条件里：跳数是这个循环唯一的终止保证，藏在循环体里读不出来。
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await doFetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
      signal: combineSignals(options.signal, options.timeoutSeconds)
    });

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');

      if (!location) {
        throw new Error(`重定向缺少 location（HTTP ${response.status}）`);
      }

      // 逐跳校验：新目标可能是内网地址或非 http 协议。
      current = await assertFetchableUrl(new URL(location, current).toString(), {
        allowRanges: options.allowRanges
      });
      continue;
    }

    if (!response.ok) {
      throw new Error(`抓取失败：HTTP ${response.status} ${current.toString()}`);
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new Error(`不支持的 Content-Type：${contentType || '未知'}（仅支持 HTML/纯文本/JSON/XML）`);
    }

    return await readBody(response, current, contentType, options);
  }

  // 跑满全部跳数还没等到非重定向响应。
  throw new Error(`重定向次数超过上限（${MAX_REDIRECTS}）`);
}

async function readBody(
  response: Response,
  url: URL,
  contentType: string,
  options: FetchPageOptions
): Promise<FetchedPage> {
  const maxBytes = options.maxBytes;
  const stream = response.body;

  if (!stream) {
    const text = await response.text();
    return {
      url: url.toString(),
      status: response.status,
      contentType,
      body: text.slice(0, maxBytes),
      truncated: text.length > maxBytes
    };
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let truncated = false;
  let body = '';

  // break 会替我们取消源流——手动持有 reader 时，那一句 cancel 得自己记得写。
  for await (const chunk of stream) {
    received += chunk.byteLength;

    if (received > maxBytes) {
      truncated = true;
      // 只保留限额内的字节；多读的这次分片按剩余预算截断。
      const overflow = received - maxBytes;
      body += decoder.decode(chunk.subarray(0, Math.max(chunk.byteLength - overflow, 0)), { stream: true });
      break;
    }

    body += decoder.decode(chunk, { stream: true });
  }

  body += decoder.decode();

  return { url: url.toString(), status: response.status, contentType, body, truncated };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function combineSignals(external: AbortSignal | undefined, timeoutSeconds: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1000);

  if (!external) {
    return timeout;
  }

  const controller = new AbortController();

  const forward = () => controller.abort();
  external.addEventListener('abort', forward, { once: true });
  timeout.addEventListener('abort', forward, { once: true });

  return controller.signal;
}

export { SsrfError };
