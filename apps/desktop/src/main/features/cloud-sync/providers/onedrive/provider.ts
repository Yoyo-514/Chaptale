import { binaryBody, formatMegabytes } from '../http';
import type { CloudCredential, CloudProviderAdapter, CloudQuota, CloudRemoteEntry } from '../provider-port';
import {
  ONEDRIVE_CLIENT_ID,
  ONEDRIVE_ENDPOINTS,
  ONEDRIVE_REDIRECT_PORT,
  ONEDRIVE_SCOPES,
  ONEDRIVE_SIMPLE_UPLOAD_LIMIT
} from './config';

type GraphFetch = typeof globalThis.fetch;

/** 落盘凭据只留 refresh token：access token 是短票，按需现换，不进配置文件。 */
type OneDriveCredential = { refreshToken: string };

/** Graph 的 driveItem：我们只读这几项，其余字段一律不碰。 */
type GraphItem = {
  id?: string;
  name?: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: unknown;
  file?: unknown;
  parentReference?: { id?: string };
};

/** 404 单独成一个类型：调用方要区分"还没建"与"真的失败了"。 */
class GraphNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphNotFoundError';
  }
}

export type OneDriveAdapterOptions = {
  /** 测试注入用；缺省使用全局 fetch。 */
  fetch?: GraphFetch;
};

export function createOneDriveAdapter(options: OneDriveAdapterOptions = {}): CloudProviderAdapter {
  const send = options.fetch ?? globalThis.fetch;
  /** 进程内短票缓存：同一个 refresh token 在有效期内不重复换票。 */
  const tokens = new Map<string, { token: string; expiresAt: number }>();
  /**
   * 应用文件夹的标识。
   *
   * 列目录时要靠它判断"上一级是不是最顶层"：应用文件夹就是我们这棵树的最顶层，
   * 它自己的上一级（网盘根）不表示出来。它在服务端是稳定的，一次进程内取一次就够。
   */
  let appRootId: string | null = null;

  async function getJson(
    url: string,
    action: string,
    token: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const response = await send(url, {
      headers: { authorization: `Bearer ${token}` },
      signal
    });

    return readJson(response, action);
  }

  async function postJson(
    url: string,
    body: unknown,
    action: string,
    token: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const response = await send(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });

    return readJson(response, action);
  }

  async function accessTokenFor(credential: CloudCredential, signal?: AbortSignal): Promise<string> {
    const { refreshToken } = readCredential(credential);
    const now = Date.now();
    const hit = tokens.get(refreshToken);

    // 提前一分钟换票，留出一次请求的余量，免得在飞行中过期。
    if (hit && hit.expiresAt - 60_000 > now) {
      return hit.token;
    }

    const payload = await postForm(
      ONEDRIVE_ENDPOINTS.token,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: ONEDRIVE_CLIENT_ID,
        // 刷新时再声明一次权限：换了权限表的旧凭据也能得到正确的票。
        scope: ONEDRIVE_SCOPES.join(' ')
      },
      '刷新 OneDrive 令牌',
      send,
      signal
    );
    const token = requireString(payload.access_token, 'OneDrive 未返回访问令牌');
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 0;

    // 没拿到有效期就不缓存：宁可不命中，也不要拿一张可能已过期的票去请求。
    tokens.set(refreshToken, { token, expiresAt: now + expiresIn * 1000 });

    return token;
  }

  /** 应用文件夹本身；还没被服务端建出来时返回 null（第一次写入才会建）。 */
  async function appRootFor(token: string, signal?: AbortSignal): Promise<GraphItem | null> {
    try {
      const item = await getJson(ONEDRIVE_ENDPOINTS.appRoot, '读取 OneDrive 应用文件夹', token, signal);

      if (typeof item.id === 'string' && item.id) {
        appRootId = item.id;
      }

      return item;
    } catch (error) {
      // 404 是"还没建"，不是故障：作者还没写过任何东西的账号就该走这条路。
      if (error instanceof GraphNotFoundError) {
        return null;
      }

      throw error;
    }
  }

  /** 上一级：应用文件夹算最顶层，它下面的直接子项就没有上一级可回。 */
  function parentOfItem(item: GraphItem): string | null {
    const parent = item.parentReference?.id;

    if (!parent || parent === appRootId) {
      return null;
    }

    return parent;
  }

  /** 列一页拿一页，直到 `@odata.nextLink` 断掉；默认页大小 200，作品目录装得下。 */
  async function listAllChildren(folderId: string, token: string, signal?: AbortSignal): Promise<GraphItem[]> {
    const select = '$select=id,name,size,lastModifiedDateTime,folder,file,parentReference';
    const items: GraphItem[] = [];
    let next: string | null = `${ONEDRIVE_ENDPOINTS.items}/${folderId}/children?${select}&$top=200`;

    while (next) {
      const payload = await getJson(next, '列出 OneDrive 目录', token, signal);

      items.push(...readValues(payload));

      // 退出条件写在循环头：分页链接取不到就结束，不靠循环体里的 break。
      next = typeof payload['@odata.nextLink'] === 'string' ? payload['@odata.nextLink'] : null;
    }

    return items;
  }

  return {
    id: 'onedrive',
    // App folder 接入：最顶层就是应用自己的文件夹，绑定它不再套容器目录。
    topLevelIsAppScoped: true,

    oauth: () =>
      ONEDRIVE_CLIENT_ID
        ? {
            clientId: ONEDRIVE_CLIENT_ID,
            authorizeEndpoint: ONEDRIVE_ENDPOINTS.authorize,
            scopes: [...ONEDRIVE_SCOPES],
            redirectPort: ONEDRIVE_REDIRECT_PORT,
            /**
             * 主机必须是 `localhost`、末尾不带路径：门户里登记的（也是唯一能在门户里新增的 http 形状）
             * 就是 `http://localhost`，而它的端口在匹配时被忽略，所以这里端口随机也不影响匹配。
             * 写成 `127.0.0.1` 会被 Entra 判成“没有登记的 redirect_uri”。
             */
            redirectUri: port => `http://localhost:${port}`,
            // 不带 response_mode 会走 fragment 把 code 放在 # 后面，回环回调读不到；
            // prompt=select_account 让同时登录了两个账号的人能选，而不是被默认账号带走。
            extraAuthorizeParams: { response_mode: 'query', prompt: 'select_account' }
          }
        : null,

    async exchangeCode({ code, codeVerifier, redirectUri, signal }) {
      const payload = await postForm(
        ONEDRIVE_ENDPOINTS.token,
        {
          code,
          grant_type: 'authorization_code',
          client_id: ONEDRIVE_CLIENT_ID,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          scope: ONEDRIVE_SCOPES.join(' ')
        },
        '换取 OneDrive 凭据',
        send,
        signal
      );
      const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';

      if (!refreshToken) {
        throw new Error('OneDrive 未返回 refresh token：授权请求缺少 offline_access');
      }

      const token = requireString(payload.access_token, 'OneDrive 未返回访问令牌');
      const account = await getJson(
        `${ONEDRIVE_ENDPOINTS.me}?$select=displayName,userPrincipalName`,
        '读取 OneDrive 账号',
        token,
        signal
      );

      return { credential: { refreshToken }, profile: { displayName: displayNameOf(account) } };
    },

    async listEntries({ credential, parentId, signal }) {
      const token = await accessTokenFor(credential, signal);
      const root = parentId ? null : await appRootFor(token, signal);

      if (!parentId && !root) {
        // 应用文件夹还没建：如实报一个空的顶层，而不是编一棵不存在的目录树。
        return { current: { id: null, name: '应用文件夹', root: true }, parentId: null, entries: [] };
      }

      const folder = parentId
        ? await getJson(
            `${ONEDRIVE_ENDPOINTS.items}/${parentId}?$select=id,name,parentReference`,
            '读取 OneDrive 目录',
            token,
            signal
          )
        : root!;

      // 只知道子目录、还不知道应用文件夹是哪一个时要先把它学出来：
      // 不然“上一级是不是最顶层”判不出来，面包屑会指向一个作者没概念的条目。
      if (parentId && !appRootId) {
        await appRootFor(token, signal).catch(() => null);
      }

      const folderId = parentId ?? requireString(root?.id, 'OneDrive 未返回应用文件夹标识');
      const entries = await listAllChildren(folderId, token, signal);

      return {
        current: parentId
          ? { id: parentId, name: typeof folder.name === 'string' ? folder.name : '', root: false }
          : { id: null, name: typeof folder.name === 'string' ? folder.name : '应用文件夹', root: true },
        parentId: parentId ? parentOfItem(folder) : null,
        entries: entries.map(toEntry)
      };
    },

    async createFolder({ credential, parentId, name, signal }) {
      const token = await accessTokenFor(credential, signal);
      const payload = await postJson(
        `${folderEndpoint(parentId)}/children`,
        {
          name,
          folder: {},
          // fail 而不是 rename：调用方总是先找同名目录，能走到这里说明它认为不该重名。
          '@microsoft.graph.conflictBehavior': 'fail'
        },
        '创建 OneDrive 目录',
        token,
        signal
      );

      return toEntry(payload);
    },

    async upload({ credential, parentId, name, bytes, signal }) {
      if (bytes.byteLength > ONEDRIVE_SIMPLE_UPLOAD_LIMIT) {
        throw new Error(
          `归档 ${formatMegabytes(bytes.byteLength)} 超过 OneDrive 单次上传上限 ${formatMegabytes(ONEDRIVE_SIMPLE_UPLOAD_LIMIT)}；` +
            '可在云端手动上传该文件，或在作品里分离大附件后重试'
        );
      }

      const token = await accessTokenFor(credential, signal);
      /**
       * 重名的默认行为是 **replace**，也就是静默覆盖云端已有的同名归档——这条必须显式改掉。
       * `rename` 与 Dropbox 那边的 `autorename` 同一语义：同秒重名由服务商改名，绝不覆盖。
       * 而且它是**查询参数**、不是请求体字段；放进 body 会被忽略，服务端仍按 replace 走。
       */
      const url =
        `${folderEndpoint(parentId)}:/${encodeURIComponent(name)}:/content` +
        '?@microsoft.graph.conflictBehavior=rename';
      const response = await send(url, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body: binaryBody(bytes),
        signal: signal as AbortSignal | undefined
      });

      return toEntry(await readJson(response, '上传归档'));
    },

    async download({ credential, fileId, signal }) {
      const token = await accessTokenFor(credential, signal);
      const response = await send(`${ONEDRIVE_ENDPOINTS.items}/${fileId}/content`, {
        headers: { authorization: `Bearer ${token}` },
        // 302 指向一个预签名 URL：跟着走即可。跨域跳转上 fetch 会按规范丢掉 Authorization，
        // 而那个 URL 本来也不需要令牌。
        redirect: 'follow',
        signal
      });

      if (!response.ok) {
        // 下载成功的响应体是文件本身，读不了 JSON；只有失败时才可能是 JSON 错误体。
        throw new Error(`下载归档失败（HTTP ${response.status}）：${await summarizeFailure(response)}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    },

    async quota({ credential, signal }): Promise<CloudQuota | null> {
      const token = await accessTokenFor(credential, signal);
      const payload = await getJson(`${ONEDRIVE_ENDPOINTS.drive}?$select=quota`, '读取 OneDrive 配额', token, signal);
      const quota = (payload.quota ?? {}) as { used?: unknown; total?: unknown };
      const used = typeof quota.used === 'number' ? quota.used : null;
      const total = typeof quota.total === 'number' ? quota.total : null;

      return used === null || total === null ? null : { usedBytes: used, totalBytes: total };
    },

    async remove({ credential, entryId, signal }) {
      const token = await accessTokenFor(credential, signal);
      const response = await send(`${ONEDRIVE_ENDPOINTS.items}/${entryId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
        signal
      });

      // 删除成功是 204，没有响应体；失败时才有 JSON 错误体。
      if (!response.ok) {
        throw new Error(`删除云端归档失败（HTTP ${response.status}）：${await summarizeFailure(response)}`);
      }
    }
  };
}

/** 建目录与上传都要一个确定的父目录：应用文件夹还没建过就用它自己的路径式端点。 */
function folderEndpoint(parentId: string | null): string {
  return parentId ? `${ONEDRIVE_ENDPOINTS.items}/${parentId}` : ONEDRIVE_ENDPOINTS.appRoot;
}

function toEntry(item: GraphItem): CloudRemoteEntry {
  const name = typeof item.name === 'string' ? item.name : '';
  const id = typeof item.id === 'string' ? item.id : null;

  if (item.folder) {
    return { id, name, kind: 'folder' };
  }

  return {
    id,
    name,
    kind: 'file',
    ...(typeof item.size === 'number' ? { size: item.size } : {}),
    ...(typeof item.lastModifiedDateTime === 'string' ? { modifiedAt: item.lastModifiedDateTime } : {})
  };
}

function readValues(payload: Record<string, unknown>): GraphItem[] {
  return Array.isArray(payload.value) ? (payload.value as GraphItem[]) : [];
}

function readCredential(credential: CloudCredential): OneDriveCredential {
  const refreshToken = credential.refreshToken;

  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('OneDrive 凭据缺少 refresh token，请重新登录');
  }

  return { refreshToken };
}

function displayNameOf(account: Record<string, unknown>): string {
  if (typeof account.displayName === 'string' && account.displayName) {
    return account.displayName;
  }

  return typeof account.userPrincipalName === 'string' && account.userPrincipalName
    ? account.userPrincipalName
    : 'OneDrive 账号';
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(message);
  }

  return value;
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  action: string,
  send: GraphFetch,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const response = await send(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    signal
  });

  return readJson(response, action);
}

async function readJson(response: Response, action: string): Promise<Record<string, unknown>> {
  if (response.status === 404) {
    throw new GraphNotFoundError(`${action}：远端没有这个条目`);
  }

  if (!response.ok) {
    throw new Error(`${action}失败（HTTP ${response.status}）：${await summarizeFailure(response)}`);
  }

  const text = await response.text();

  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** Graph 的错误体是 `{error: {code, message}}`；取 message 给作者看，取不到就截断原文。 */
async function summarizeFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');

  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };

    if (typeof parsed.error?.message === 'string' && parsed.error.message) {
      return parsed.error.message;
    }
  } catch {
    // 非 JSON 错误体按原文截断，不进 JSON.parse 分支。
  }

  return text.slice(0, 300) || '无响应内容';
}
