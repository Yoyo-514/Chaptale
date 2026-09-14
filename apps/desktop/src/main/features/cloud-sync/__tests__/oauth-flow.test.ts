import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { runAuthorizationCodeFlow, type OAuthFlowOptions } from '../oauth-flow';

/** 默认选项；各用例只覆盖自己关心的字段。 */
const baseOptions: OAuthFlowOptions = {
  clientId: 'client-id',
  authorizeEndpoint: 'https://provider.test/authorize',
  scopes: ['files.content.write', 'account_info.read'],
  redirectPort: 0,
  // 主机与末尾斜杠由适配器决定；这里用回环 IPv4，与 Dropbox 那条一致。
  redirectUri: port => `http://127.0.0.1:${port}/`,
  openExternal: async () => undefined
};

/**
 * 用真实 HTTP 请求扮演"作者点完授权页回到回环地址"。
 * 走的是同一个真实回调服务器与同一段回调解析，不打桩、不替换被测函数。
 */
function fakeBrowser(query: (state: string) => Record<string, string>) {
  const pages: string[] = [];
  const authorizeUrls: string[] = [];

  return {
    pages,
    authorizeUrls,
    openExternal: async (url: string) => {
      authorizeUrls.push(url);
      const authorize = new URL(url);
      const callback = new URL(authorize.searchParams.get('redirect_uri') ?? '');
      for (const [key, value] of Object.entries(query(authorize.searchParams.get('state') ?? ''))) {
        callback.searchParams.set(key, value);
      }
      const response = await fetch(callback);
      expect(response.status).toBe(200);
      pages.push(await response.text());
    }
  };
}

describe('授权码 + PKCE 回环流程', () => {
  it('收到合规回调后返回授权码，且 challenge 与 verifier 配对', async () => {
    const browser = fakeBrowser(state => ({ code: 'auth-code', state }));
    const result = await runAuthorizationCodeFlow({ ...baseOptions, openExternal: browser.openExternal });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe('auth-code');
    expect(result.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    // 宣告出去的回调地址就是发去授权页的那个：两处不一致的话服务商会直接拒。
    const authorizeForRedirect = new URL(browser.authorizeUrls[0] ?? '');
    expect(authorizeForRedirect.searchParams.get('redirect_uri')).toBe(result.redirectUri);
    expect(browser.pages[0]).toContain('授权完成');

    const authorize = new URL(browser.authorizeUrls[0] ?? '');
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('scope')).toBe('files.content.write account_info.read');
    expect(authorize.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(result.codeVerifier).digest('base64url')
    );
  });
  it('state 不一致时拒绝回调，不把授权码交给调用方', async () => {
    const browser = fakeBrowser(() => ({ code: 'auth-code', state: 'forged' }));
    const result = await runAuthorizationCodeFlow({ ...baseOptions, openExternal: browser.openExternal });

    expect(result).toEqual({ ok: false, code: 'failed', message: expect.stringContaining('state') });
    expect(browser.pages[0]).toContain('授权未完成');
  });
  it('授权页拒绝是正常结局，与真实故障分开表达', async () => {
    const browser = fakeBrowser(() => ({ error: 'access_denied' }));

    await expect(runAuthorizationCodeFlow({ ...baseOptions, openExternal: browser.openExternal })).resolves.toEqual({
      ok: false,
      code: 'denied',
      message: expect.stringContaining('拒绝')
    });
  });
  it('服务商错误只作为文本回显，不注入回调页', async () => {
    const browser = fakeBrowser(() => ({ error: '<img src=x onerror=alert(1)>' }));
    const result = await runAuthorizationCodeFlow({ ...baseOptions, openExternal: browser.openExternal });

    expect(result.ok).toBe(false);
    expect(browser.pages[0]).not.toContain('<img');
    expect(browser.pages[0]).toContain('&lt;img');
  });
  it('等待超时与主动取消各自收尾，不无限挂着', async () => {
    await expect(
      runAuthorizationCodeFlow({ ...baseOptions, timeoutMs: 40, openExternal: async () => undefined })
    ).resolves.toEqual({ ok: false, code: 'timeout', message: expect.any(String) });

    const controller = new AbortController();
    const pending = runAuthorizationCodeFlow({
      ...baseOptions,
      signal: controller.signal,
      openExternal: async () => undefined
    });
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, code: 'canceled', message: expect.any(String) });
  });
  it('浏览器打不开时立刻报错，不留悬空回调', async () => {
    await expect(
      runAuthorizationCodeFlow({
        ...baseOptions,
        openExternal: async () => {
          throw new Error('没有可用的浏览器');
        }
      })
    ).resolves.toEqual({ ok: false, code: 'failed', message: expect.stringContaining('没有可用的浏览器') });
  });
});
