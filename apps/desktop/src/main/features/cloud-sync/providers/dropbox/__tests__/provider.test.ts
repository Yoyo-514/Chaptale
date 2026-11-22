import { describe, expect, it } from 'vitest';

import { createStubFetch } from '../../__tests__/stub-fetch';
import { DROPBOX_SIMPLE_UPLOAD_LIMIT } from '../config';
import { createDropboxAdapter } from '../provider';

const tokenReply = { access_token: 'short-lived', refresh_token: 'refresh-1', expires_in: 14400 };

describe('Dropbox 适配器', () => {
  it('授权配置带 PKCE 所需字段与固定回环端口，并要求离线刷新令牌', () => {
    const oauth = createDropboxAdapter().oauth();

    expect(oauth?.clientId).toBeTruthy();
    expect(oauth?.authorizeEndpoint).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(oauth?.redirectPort).toBeGreaterThan(1024);
    expect(oauth?.extraAuthorizeParams).toEqual({ token_access_type: 'offline' });
    expect(oauth?.scopes).toContain('files.content.write');
    // 主机 127.0.0.1 + 末尾斜杠：App Console 登记的就是这个串，必须逐字符相同。
    expect(oauth?.redirectUri(52475)).toBe('http://127.0.0.1:52475/');
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
  it('列出应用文件夹顶层的文件与目录，按游标翻页', async () => {
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
    const entries = await createDropboxAdapter({ fetch: stub.send }).listEntries({
      credential: { refreshToken: 'refresh-1' }
    });

    expect(entries).toEqual([
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
  it('短票在有效期内不重复换取', async () => {
    const stub = createStubFetch([tokenReply, { entries: [], has_more: false }, { entries: [], has_more: false }]);
    const adapter = createDropboxAdapter({ fetch: stub.send });

    await adapter.listEntries({ credential: { refreshToken: 'r' } });
    await adapter.listEntries({ credential: { refreshToken: 'r' } });

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
  it('超过单次上传上限时直接报错，连换票请求都不发', async () => {
    const stub = createStubFetch([tokenReply]);
    // 真分配一次超限缓冲：这是适配器自己声明的上限，只能拿真实尺寸去撞。
    const oversized = new Uint8Array(DROPBOX_SIMPLE_UPLOAD_LIMIT + 1);

    await expect(
      createDropboxAdapter({ fetch: stub.send }).upload({
        credential: { refreshToken: 'r' },
        name: 'big.zip',
        bytes: oversized
      })
    ).rejects.toThrow('单次上传上限');
    expect(stub.calls).toHaveLength(0);
  });
});
