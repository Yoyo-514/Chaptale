import { describe, expect, it } from 'vitest';

import { DROPBOX_SIMPLE_UPLOAD_LIMIT } from '../config';
import { createDropboxAdapter } from '../provider';

type Call = { url: string; method: string; body: string; headers: Record<string, string> };

/** 注入的 fetch：记录请求、回放固定报文。不替代被测函数，测的就是适配器自己怎么发请求、怎么解响应。 */
function createStubFetch(replies: Array<Response | unknown>) {
  const calls: Call[] = [];
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

const tokenReply = { access_token: 'short-lived', refresh_token: 'refresh-1', expires_in: 14400 };

describe('Dropbox 适配器', () => {
  it('授权配置带 PKCE 所需字段与固定回环端口，并要求离线刷新令牌', () => {
    const oauth = createDropboxAdapter().oauth();

    expect(oauth?.clientId).toBeTruthy();
    expect(oauth?.authorizeEndpoint).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(oauth?.redirectPort).toBeGreaterThan(1024);
    expect(oauth?.extraAuthorizeParams).toEqual({ token_access_type: 'offline' });
    expect(oauth?.scopes).toContain('files.content.write');
  });
  it('用授权码换到 refresh token 与账号显示名，短票不进凭据', async () => {
    const stub = createStubFetch([tokenReply, { name: { display_name: '张三' }, email: 'a@example.com' }]);
    const result = await createDropboxAdapter({ fetch: stub.send }).exchangeCode({
      code: 'auth-code',
      codeVerifier: 'verifier',
      redirectUri: 'http://127.0.0.1:52475/'
    });

    expect(result.credential).toEqual({ refreshToken: 'refresh-1' });
    expect(result.profile.displayName).toBe('张三');

    const [token, account] = stub.calls;
    expect(token?.url).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(token?.method).toBe('POST');
    expect(token?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(token?.body).entries())).toMatchObject({
      grant_type: 'authorization_code',
      code: 'auth-code',
      code_verifier: 'verifier',
      redirect_uri: 'http://127.0.0.1:52475/'
    });
    expect(account?.url).toBe('https://api.dropboxapi.com/2/users/get_current_account');
    expect(account?.headers.authorization).toBe('Bearer short-lived');
  });
  it('拿不到 refresh token 时指明是授权参数问题，不谎报网络故障', async () => {
    const stub = createStubFetch([{ access_token: 'short-lived' }]);

    await expect(
      createDropboxAdapter({ fetch: stub.send }).exchangeCode({
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: 'http://127.0.0.1:52475/'
      })
    ).rejects.toThrow('token_access_type=offline');
  });
  it('列目录同时给出文件与目录、按游标翻页，顶层用空路径而不是伪造的 id', async () => {
    const stub = createStubFetch([
      tokenReply,
      {
        entries: [
          { '.tag': 'folder', name: '备份', path_display: '/备份' },
          {
            '.tag': 'file',
            name: '拾光之城 pc 20260913-210405.zip',
            path_display: '/拾光之城 pc 20260913-210405.zip',
            size: 2048,
            server_modified: '2026-09-13T21:04:05Z'
          }
        ],
        cursor: 'cursor-1',
        has_more: true
      },
      { entries: [{ '.tag': 'folder', name: '旧稿', path_display: '/旧稿' }], has_more: false }
    ]);
    const listing = await createDropboxAdapter({ fetch: stub.send }).listEntries({
      credential: { refreshToken: 'refresh-1' }
    });

    expect(listing.current).toEqual({ id: null, name: '应用文件夹', root: true });
    expect(listing.parentId).toBeNull();
    expect(listing.entries).toEqual([
      { id: '/备份', name: '备份', kind: 'folder' },
      {
        id: '/拾光之城 pc 20260913-210405.zip',
        name: '拾光之城 pc 20260913-210405.zip',
        kind: 'file',
        size: 2048,
        modifiedAt: '2026-09-13T21:04:05Z'
      },
      { id: '/旧稿', name: '旧稿', kind: 'folder' }
    ]);
    expect(JSON.parse(stub.calls[1]?.body ?? '')).toEqual({
      path: '',
      recursive: false,
      include_deleted: false
    });
    expect(JSON.parse(stub.calls[2]?.body ?? '')).toEqual({ cursor: 'cursor-1' });
  });
  it('下钻用路径定位，上一级由路径推导；短票在有效期内不重复换取', async () => {
    const stub = createStubFetch([tokenReply, { entries: [], has_more: false }, { entries: [], has_more: false }]);
    const adapter = createDropboxAdapter({ fetch: stub.send });

    const nested = await adapter.listEntries({ credential: { refreshToken: 'r' }, parentId: '/a/b' });

    expect(nested.current).toEqual({ id: '/a/b', name: 'b', root: false });
    expect(nested.parentId).toBe('/a');
    expect(JSON.parse(stub.calls[1]?.body ?? '')).toMatchObject({ path: '/a/b' });

    const topChild = await adapter.listEntries({ credential: { refreshToken: 'r' }, parentId: '/备份' });

    expect(topChild.current.root).toBe(false);
    expect(topChild.parentId).toBeNull();
    expect(stub.calls.filter(call => call.url.endsWith('/oauth2/token'))).toHaveLength(1);
  });
  it('凭据损坏与远端报错都带出可读原因，不返回空目录冒充成功', async () => {
    const broken = createStubFetch([tokenReply]);

    await expect(
      createDropboxAdapter({ fetch: broken.send }).listEntries({ credential: { accessToken: 'x' } })
    ).rejects.toThrow('请重新登录');

    const failing = createStubFetch([
      new Response(JSON.stringify({ error_summary: 'invalid_grant/…' }), { status: 400 })
    ]);

    await expect(
      createDropboxAdapter({ fetch: failing.send }).listEntries({ credential: { refreshToken: 'r' } })
    ).rejects.toThrow('HTTP 400');
  });
  it('上传用 add + autorename，同名文件由服务商改名而不覆盖云端已有内容', async () => {
    const name = '拾光之城 pc 20260913-210405.zip';
    const stub = createStubFetch([
      tokenReply,
      { '.tag': 'file', name, path_display: `/${name}`, size: 3, server_modified: '2026-09-13T21:04:05Z' }
    ]);
    const entry = await createDropboxAdapter({ fetch: stub.send }).upload({
      credential: { refreshToken: 'r' },
      parentId: null,
      name,
      bytes: new Uint8Array([1, 2, 3])
    });

    expect(entry).toEqual({ id: `/${name}`, name, kind: 'file', size: 3, modifiedAt: '2026-09-13T21:04:05Z' });

    const call = stub.calls[1];

    expect(call?.url).toBe('https://api.dropboxapi.com/2/files/upload');
    expect(call?.headers['content-type']).toBe('application/octet-stream');
    expect(JSON.parse(call?.headers['dropbox-api-arg'] ?? '')).toEqual({
      path: `/${name}`,
      mode: 'add',
      autorename: true,
      mute: true
    });
    // 头只能是 ASCII：中文名必须转义后再进头，否则真机上直接抛 ByteString 错误。
    expect(call?.headers['dropbox-api-arg']).not.toMatch(/[^\x20-\x7e]/);
  });
  it('下载返回原始字节，失败时带出状态与原因', async () => {
    const name = '拾光之城 pc 20260913-210405.zip';
    const ok = createStubFetch([tokenReply, new Response('zip-bytes', { status: 200 })]);
    const bytes = await createDropboxAdapter({ fetch: ok.send }).download({
      credential: { refreshToken: 'r' },
      fileId: `/${name}`
    });

    expect(new TextDecoder().decode(bytes)).toBe('zip-bytes');
    expect(JSON.parse(ok.calls[1]?.headers['dropbox-api-arg'] ?? '')).toEqual({ path: `/${name}` });
    expect(ok.calls[1]?.headers['dropbox-api-arg']).not.toMatch(/[^\x20-\x7e]/);

    const failing = createStubFetch([
      tokenReply,
      new Response(JSON.stringify({ error_summary: 'not_found/…' }), { status: 409 })
    ]);

    await expect(
      createDropboxAdapter({ fetch: failing.send }).download({
        credential: { refreshToken: 'r' },
        fileId: '/missing.zip'
      })
    ).rejects.toThrow('not_found');
  });
  it('建目录用完整远端路径，不交给服务商自动改名', async () => {
    const stub = createStubFetch([tokenReply, { metadata: { '.tag': 'folder', name: '备份', path_display: '/备份' } }]);
    const folder = await createDropboxAdapter({ fetch: stub.send }).createFolder({
      credential: { refreshToken: 'r' },
      parentId: null,
      name: '备份'
    });

    expect(folder).toEqual({ id: '/备份', name: '备份', kind: 'folder' });
    expect(JSON.parse(stub.calls[1]?.body ?? '')).toEqual({ path: '/备份', autorename: false });
  });
  it('配额读不出来时返回 null，界面显示“未提供”而不是编一个数', async () => {
    const ok = createStubFetch([tokenReply, { used: 1024, allocation: { allocated: 4096 } }]);

    await expect(
      createDropboxAdapter({ fetch: ok.send }).quota({ credential: { refreshToken: 'r' } })
    ).resolves.toEqual({ usedBytes: 1024, totalBytes: 4096 });

    const partial = createStubFetch([tokenReply, { used: 1024 }]);

    await expect(
      createDropboxAdapter({ fetch: partial.send }).quota({ credential: { refreshToken: 'r' } })
    ).resolves.toBeNull();
  });
  it('超过单次上传上限时直接报错，连换票请求都不发', async () => {
    const stub = createStubFetch([tokenReply]);
    // 真分配一次超限缓冲：这是适配器自己声明的上限，只能拿真实尺寸去撞。
    const oversized = new Uint8Array(DROPBOX_SIMPLE_UPLOAD_LIMIT + 1);

    await expect(
      createDropboxAdapter({ fetch: stub.send }).upload({
        credential: { refreshToken: 'r' },
        parentId: null,
        name: 'big.zip',
        bytes: oversized
      })
    ).rejects.toThrow('单次上传上限');
    expect(stub.calls).toHaveLength(0);
  });
});
