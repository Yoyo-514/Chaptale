import { describe, expect, it } from 'vitest';

import { createStubFetch } from '../../__tests__/stub-fetch';
import { ONEDRIVE_CLIENT_ID, ONEDRIVE_SIMPLE_UPLOAD_LIMIT } from '../config';
import { createOneDriveAdapter } from '../provider';

const tokenReply = { access_token: 'short-lived', refresh_token: 'refresh-1', expires_in: 3600 };
const APP_ROOT_ID = 'APPS-ROOT';
const CHILD_FOLDER_ID = 'FOLDER-正文';

/** 应用文件夹还没被服务端建出来时的真实响应形状。 */
function notFound(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'itemNotFound', message: 'The resource could not be found.' } }),
    { status: 404 }
  );
}

const appRootItem = { id: APP_ROOT_ID, name: 'Chaptale' };

describe('OneDrive 适配器', () => {
  it('凭据配好之前不给登录入口；配好后带齐 PKCE 与离线刷新所需字段', () => {
    const oauth = createOneDriveAdapter().oauth();

    if (!ONEDRIVE_CLIENT_ID) {
      // 本构建没内置 client id：界面只会显示“未配置”，不会给一个点了必然失败的入口。
      expect(oauth).toBeNull();

      return;
    }

    expect(oauth?.authorizeEndpoint).toContain('/common/oauth2/v2.0/authorize');
    expect(oauth?.scopes).toContain('offline_access');
    // 不带 response_mode 会走 fragment，回环回调读不到 code。
    expect(oauth?.extraAuthorizeParams).toEqual({ response_mode: 'query', prompt: 'select_account' });
    // 回环地址的端口在匹配时被忽略，所以这里用随机端口：端口被占用不再是一种失败。
    expect(oauth?.redirectPort).toBe(0);
    // 主机必须是 localhost：门户里能登记的 http 回环形状只有它，写 127.0.0.1 会被判成没登记。
    expect(oauth?.redirectUri(52341)).toBe('http://localhost:52341');
  });

  it('用授权码换到 refresh token 与账号显示名，短票不进凭据', async () => {
    const stub = createStubFetch([tokenReply, { displayName: '张三', userPrincipalName: 'z@example.com' }]);
    const result = await createOneDriveAdapter({ fetch: stub.send }).exchangeCode({
      code: 'auth-code',
      codeVerifier: 'verifier',
      redirectUri: 'http://localhost:52476/'
    });

    expect(result.credential).toEqual({ refreshToken: 'refresh-1' });
    expect(result.profile.displayName).toBe('张三');

    const [token, account] = stub.calls;

    expect(token?.url).toContain('/oauth2/v2.0/token');
    expect(token?.body).toContain('grant_type=authorization_code');
    expect(token?.body).toContain('code_verifier=verifier');
    expect(account?.url).toContain('/me');
  });

  it('没拿到 refresh token 就不落一份用不了的凭据', async () => {
    const stub = createStubFetch([{ access_token: 'short-lived', expires_in: 3600 }]);

    await expect(
      createOneDriveAdapter({ fetch: stub.send }).exchangeCode({
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: 'http://localhost:52476/'
      })
    ).rejects.toThrow('offline_access');
  });

  it('同一次运行里只换一张票：几次调用共用一个 access token', async () => {
    const stub = createStubFetch([tokenReply, appRootItem, { value: [] }, appRootItem, { value: [] }]);
    const adapter = createOneDriveAdapter({ fetch: stub.send });
    const credential = { refreshToken: 'refresh-1' };

    await adapter.listEntries({ credential });
    await adapter.listEntries({ credential });

    expect(stub.calls.filter(call => call.url.includes('/token'))).toHaveLength(1);
  });

  it('应用文件夹还没建出来时给一个空顶层，而不是报错', async () => {
    const stub = createStubFetch([tokenReply, notFound()]);
    const listing = await createOneDriveAdapter({ fetch: stub.send }).listEntries({
      credential: { refreshToken: 'refresh-1' }
    });

    expect(listing.current).toEqual({ id: null, name: '应用文件夹', root: true });
    expect(listing.parentId).toBeNull();
    expect(listing.entries).toEqual([]);
  });

  it('列目录翻页取全，并把 driveItem 折成端口条目', async () => {
    const stub = createStubFetch([
      tokenReply,
      appRootItem,
      {
        value: [
          { id: 'file-1', name: '长夜 pc 2026.zip', size: 2048, lastModifiedDateTime: '2026-09-13T21:04:05Z', file: {} }
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/items/next-page'
      },
      { value: [{ id: 'folder-1', name: '灵感', folder: { childCount: 0 } }] }
    ]);
    const listing = await createOneDriveAdapter({ fetch: stub.send }).listEntries({
      credential: { refreshToken: 'refresh-1' }
    });

    expect(listing.parentId).toBeNull();
    expect(listing.current.root).toBe(true);
    expect(listing.entries).toEqual([
      { id: 'file-1', name: '长夜 pc 2026.zip', kind: 'file', size: 2048, modifiedAt: '2026-09-13T21:04:05Z' },
      { id: 'folder-1', name: '灵感', kind: 'folder' }
    ]);
    // 第二页必须走服务端给的那条链接：自己拼页码会在 $skip 上限处悄悄丢东西。
    expect(stub.calls[3]?.url).toBe('https://graph.microsoft.com/v1.0/me/drive/items/next-page');
  });

  it('列出子目录时带上自己的名字与上一级；应用文件夹算最顶层', async () => {
    const stub = createStubFetch([
      tokenReply,
      // 列子目录时先读目录自身，再去学一次应用文件夹是谁：判断“上一级是不是最顶层”要用到它。
      { id: CHILD_FOLDER_ID, name: '正文', parentReference: { id: APP_ROOT_ID } },
      appRootItem,
      { value: [] },
      { id: 'FOLDER-二稿', name: '二稿', parentReference: { id: CHILD_FOLDER_ID } },
      { value: [] }
    ]);
    const adapter = createOneDriveAdapter({ fetch: stub.send });
    const credential = { refreshToken: 'refresh-1' };

    const direct = await adapter.listEntries({ credential, parentId: CHILD_FOLDER_ID });

    // 应用文件夹下面的直接子项：上一级就是最顶层，不再往上爬到一个作者没概念的网盘根。
    expect(direct.current).toEqual({ id: CHILD_FOLDER_ID, name: '正文', root: false });
    expect(direct.parentId).toBeNull();

    const deeper = await adapter.listEntries({ credential, parentId: 'FOLDER-二稿' });

    expect(deeper.parentId).toBe(CHILD_FOLDER_ID);
  });

  it('上传显式要求重名改名，名字按 URL 编码——默认行为会静默覆盖', async () => {
    const stub = createStubFetch([tokenReply, { id: 'file-1', name: '长夜 pc.zip', size: 3, file: {} }]);
    const name = '长夜 pc 20260913-210405.zip';
    const entry = await createOneDriveAdapter({ fetch: stub.send }).upload({
      credential: { refreshToken: 'refresh-1' },
      parentId: null,
      name,
      bytes: new Uint8Array([1, 2, 3])
    });

    expect(entry).toEqual({ id: 'file-1', name: '长夜 pc.zip', kind: 'file', size: 3 });

    const call = stub.calls[1];

    expect(call?.method).toBe('PUT');
    expect(call?.url).toContain(`:/${encodeURIComponent(name)}:/content`);
    // 这条是"绝不覆盖云端已有内容"的落点：默认是 replace，必须显式改成 rename。
    expect(call?.url).toContain('@microsoft.graph.conflictBehavior=rename');
    expect(call?.headers['content-type']).toBe('application/octet-stream');
  });

  it('超过单次上传上限就如实拦住，不去开分片会话', async () => {
    const adapter = createOneDriveAdapter({ fetch: createStubFetch([]).send });

    await expect(
      adapter.upload({
        credential: { refreshToken: 'refresh-1' },
        parentId: null,
        name: '大附件.zip',
        bytes: new Uint8Array(ONEDRIVE_SIMPLE_UPLOAD_LIMIT + 1)
      })
    ).rejects.toThrow('超过 OneDrive 单次上传上限');
  });

  it('配额读不到就是未提供，不编一个数', async () => {
    const adapter = createOneDriveAdapter({ fetch: createStubFetch([tokenReply, {}]).send });
    const quota = await adapter.quota({ credential: { refreshToken: 'refresh-1' } });

    expect(quota).toBeNull();
  });

  it('配额读得到就给字节数', async () => {
    const adapter = createOneDriveAdapter({
      fetch: createStubFetch([tokenReply, { quota: { used: 100, total: 1000 } }]).send
    });
    const quota = await adapter.quota({ credential: { refreshToken: 'refresh-1' } });

    expect(quota).toEqual({ usedBytes: 100, totalBytes: 1000 });
  });

  it('删除成功是 204 空响应；失败如实报原因', async () => {
    const okStub = createStubFetch([tokenReply, new Response(null, { status: 204 })]);
    const adapter = createOneDriveAdapter({ fetch: okStub.send });

    await expect(
      adapter.remove({ credential: { refreshToken: 'refresh-1' }, entryId: 'file-1' })
    ).resolves.toBeUndefined();

    const failing = createOneDriveAdapter({
      fetch: createStubFetch([
        tokenReply,
        new Response(JSON.stringify({ error: { code: 'accessDenied', message: '删除被拒绝' } }), { status: 403 })
      ]).send
    });

    await expect(failing.remove({ credential: { refreshToken: 'refresh-1' }, entryId: 'file-1' })).rejects.toThrow(
      '删除被拒绝'
    );
  });

  it('下载失败的响应体是 JSON 错误，读出来当原因', async () => {
    const adapter = createOneDriveAdapter({
      fetch: createStubFetch([
        tokenReply,
        new Response(JSON.stringify({ error: { code: 'itemNotFound', message: '归档不在了' } }), { status: 404 })
      ]).send
    });

    await expect(adapter.download({ credential: { refreshToken: 'refresh-1' }, fileId: 'file-1' })).rejects.toThrow(
      '归档不在了'
    );
  });

  it('缺凭据时要求重新登录，而不是拿空令牌去请求', async () => {
    const adapter = createOneDriveAdapter({ fetch: createStubFetch([]).send });

    await expect(adapter.listEntries({ credential: {} })).rejects.toThrow('重新登录');
  });
});
