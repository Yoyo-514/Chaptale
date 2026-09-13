import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

/**
 * 授权码 + PKCE 的本机回环流程。
 *
 * 桌面应用藏不住 client secret，所以一律走公开客户端形状：本地起一个只监听 127.0.0.1 的
 * 一次性回调端点，浏览器带 `code` 回来，再拿 `code_verifier` 去换 token。
 *
 * 取消、超时、授权页拒绝都是**正常结局**，以返回值而不是异常表达：调用方要能给作者
 * 分别说清发生了什么，而不是笼统报"登录失败"。
 */
export type OAuthFlowOptions = {
  clientId: string;
  authorizeEndpoint: string;
  scopes: readonly string[];
  /** 0 表示由系统分配空闲端口；固定端口见 `CloudOAuthConfig.redirectPort` 的说明。 */
  redirectPort: number;
  extraAuthorizeParams?: Record<string, string>;
  /** 打开系统浏览器；装配层注入 `shell.openExternal`，测试里用真实 HTTP 请求替代人工点击。 */
  openExternal: (url: string) => Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type OAuthFlowResult =
  | { ok: true; code: string; codeVerifier: string; redirectUri: string }
  | { ok: false; code: 'canceled' | 'timeout' | 'denied' | 'failed'; message: string };

type CallbackOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string };

const HOST = '127.0.0.1';
/** 在浏览器里犹豫、切账号、临时去注册都很常见，给足五分钟；到点按超时收尾，不无限挂着。 */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export async function runAuthorizationCodeFlow(options: OAuthFlowOptions): Promise<OAuthFlowResult> {
  const codeVerifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const server = createServer();

  try {
    await listen(server, options.redirectPort);
  } catch (error) {
    return {
      ok: false,
      code: 'failed',
      message: `无法监听本机回调端口 ${options.redirectPort}：${describeError(error)}`
    };
  }

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : options.redirectPort;
  const redirectUri = `http://${HOST}:${port}/`;

  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let resolveResult: ((result: OAuthFlowResult) => void) | null = null;
  const result = new Promise<OAuthFlowResult>(resolve => {
    resolveResult = resolve;
  });

  const finish = (outcome: OAuthFlowResult) => {
    if (settled || !resolveResult) return;
    settled = true;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    server.close();
    resolveResult(outcome);
  };

  function onAbort() {
    finish({ ok: false, code: 'canceled', message: '已取消登录' });
  }

  if (options.signal?.aborted) {
    return { ok: false, code: 'canceled', message: '已取消登录' };
  }

  options.signal?.addEventListener('abort', onAbort, { once: true });
  timer = setTimeout(
    () => finish({ ok: false, code: 'timeout', message: '等待授权超时，请重新发起登录' }),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  server.on('error', error => finish({ ok: false, code: 'failed', message: `回调服务出错：${describeError(error)}` }));
  server.on('request', (request, response) => {
    const url = new URL(request.url ?? '/', `http://${HOST}`);

    if (url.pathname !== '/') {
      // 浏览器会顺手请求 favicon 之类的路径；只有根路径才是一次真实回调。
      response.writeHead(404, { connection: 'close' }).end();
      return;
    }

    const outcome = readCallback(url, state);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(resultPage(outcome));
    finish(
      outcome.kind === 'code'
        ? { ok: true, code: outcome.code, codeVerifier, redirectUri }
        : { ok: false, code: outcome.kind === 'denied' ? 'denied' : 'failed', message: outcome.message }
    );
  });

  const authorizeUrl = buildAuthorizeUrl(options, { redirectUri, state, codeChallenge: challengeOf(codeVerifier) });

  try {
    await options.openExternal(authorizeUrl);
  } catch (error) {
    finish({ ok: false, code: 'failed', message: `无法打开浏览器完成授权：${describeError(error)}` });
  }

  return result;
}

function buildAuthorizeUrl(
  options: OAuthFlowOptions,
  pkce: { redirectUri: string; state: string; codeChallenge: string }
): string {
  const url = new URL(options.authorizeEndpoint);

  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', pkce.redirectUri);
  url.searchParams.set('code_challenge', pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', pkce.state);

  if (options.scopes.length > 0) {
    url.searchParams.set('scope', options.scopes.join(' '));
  }

  for (const [key, value] of Object.entries(options.extraAuthorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function challengeOf(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function readCallback(url: URL, expectedState: string): CallbackOutcome {
  const error = url.searchParams.get('error');

  if (error) {
    return error === 'access_denied'
      ? { kind: 'denied', message: '你在授权页拒绝了本次登录' }
      : { kind: 'failed', message: `服务商返回错误：${error}` };
  }

  // state 先于 code 校验：否则任何人都能往本机端口塞一个授权码。
  if (!stateMatches(url.searchParams.get('state') ?? '', expectedState)) {
    return { kind: 'failed', message: '回调 state 与本次请求不一致，已拒绝' };
  }

  const code = url.searchParams.get('code');

  return code ? { kind: 'code', code } : { kind: 'failed', message: '回调里没有授权码' };
}

function stateMatches(received: string, expected: string): boolean {
  const left = Buffer.from(received, 'utf8');
  const right = Buffer.from(expected, 'utf8');

  return left.length === right.length && timingSafeEqual(left, right);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/** 页面里出现的所有动态文本都经过转义：`error` 之类的查询参数来自本机端口的任意访问者。 */
function resultPage(outcome: CallbackOutcome): string {
  const heading = outcome.kind === 'code' ? '授权完成，可以关闭此页面' : '授权未完成';
  const detail = outcome.kind === 'code' ? '请回到 Chaptale 继续操作。' : outcome.message;

  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${escapeHtml(heading)}</title></head>`,
    '<body style="margin:0;padding:32px;font-family:system-ui,sans-serif;line-height:1.7">',
    `<h1 style="font-size:16px;margin:0 0 8px">${escapeHtml(heading)}</h1>`,
    `<p style="margin:0;color:#666">${escapeHtml(detail)}</p>`,
    '</body></html>'
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
