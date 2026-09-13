import type { CloudCredential, CloudProviderAdapter, CloudQuota, CloudRemoteEntry } from '../provider-port';
import {
  DROPBOX_APP_KEY,
  DROPBOX_ENDPOINTS,
  DROPBOX_REDIRECT_PORT,
  DROPBOX_SCOPES,
  DROPBOX_SIMPLE_UPLOAD_LIMIT
} from './config';

type DropboxFetch = typeof globalThis.fetch;

/** 落盘凭据只留 refresh token：access token 是四小时短票，按需现换，不进配置文件。 */
type DropboxCredential = { refreshToken: string };

type DropboxEntry = {
  '.tag'?: string;
  name?: string;
  path_display?: string;
  path_lower?: string;
  size?: number;
  server_modified?: string;
};

export type DropboxAdapterOptions = {
  /** 测试注入用；缺省使用全局 fetch。 */
  fetch?: DropboxFetch;
};

export function createDropboxAdapter(options: DropboxAdapterOptions = {}): CloudProviderAdapter {
  const send = options.fetch ?? globalThis.fetch;
  /** 进程内短票缓存：同一个 refresh token 在有效期内不重复换票。 */
  const tokens = new Map<string, { token: string; expiresAt: number }>();

  async function accessTokenFor(credential: CloudCredential, signal?: AbortSignal): Promise<string> {
    const { refreshToken } = readCredential(credential);
    const now = Date.now();
    const hit = tokens.get(refreshToken);

    // 提前一分钟换票，留出一次请求的余量，免得在飞行中过期。
    if (hit && hit.expiresAt - 60_000 > now) {
      return hit.token;
    }

    const payload = await postForm(
      DROPBOX_ENDPOINTS.token,
      { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: DROPBOX_APP_KEY },
      '刷新 Dropbox 令牌',
      send,
      signal
    );
    const token = requireString(payload.access_token, 'Dropbox 未返回访问令牌');
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 0;

    // 没拿到有效期就不缓存：宁可不命中，也不要拿一张可能已过期的票去请求。
    tokens.set(refreshToken, { token, expiresAt: now + expiresIn * 1000 });

    return token;
  }

  return {
    id: 'dropbox',
    // App folder 接入：服务商返回的最顶层就是 /Apps/<AppName>/，绑定它不再套容器目录。
    topLevelIsAppScoped: true,

    oauth: () => ({
      clientId: DROPBOX_APP_KEY,
      authorizeEndpoint: DROPBOX_ENDPOINTS.authorize,
      scopes: [...DROPBOX_SCOPES],
      redirectPort: DROPBOX_REDIRECT_PORT,
      // 不带这个参数只会拿到四小时短票、没有 refresh token —— 重启应用就得重新登录。
      extraAuthorizeParams: { token_access_type: 'offline' }
    }),

    async exchangeCode({ code, codeVerifier, redirectUri, signal }) {
      const payload = await postForm(
        DROPBOX_ENDPOINTS.token,
        {
          code,
          grant_type: 'authorization_code',
          client_id: DROPBOX_APP_KEY,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri
        },
        '换取 Dropbox 凭据',
        send,
        signal
      );
      const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';

      if (!refreshToken) {
        throw new Error('Dropbox 未返回 refresh token：授权请求缺少 token_access_type=offline');
      }

      const token = requireString(payload.access_token, 'Dropbox 未返回访问令牌');
      const account = await postJson(DROPBOX_ENDPOINTS.currentAccount, null, '读取 Dropbox 账号', send, token, signal);

      return { credential: { refreshToken }, profile: { displayName: displayNameOf(account) } };
    },

    async listEntries({ credential, parentId, signal }) {
      const token = await accessTokenFor(credential, signal);
      const path = remotePath(parentId);
      let payload = await listPage(
        { path, recursive: false, include_deleted: false },
        '列出 Dropbox 目录',
        token,
        signal
      );
      const entries = readEntries(payload);

      // 退出条件写在循环头：分页游标取不到就结束，不靠循环体里的 break。
      for (let cursor = readCursor(payload); cursor; cursor = readCursor(payload)) {
        payload = await listPage({ cursor }, '继续列出 Dropbox 目录', token, signal);
        entries.push(...readEntries(payload));
      }

      return { current: describeFolder(path), parentId: parentOf(path), entries: entries.map(toEntry) };
    },

    async createFolder({ credential, parentId, name, signal }) {
      const token = await accessTokenFor(credential, signal);
      const payload = await postJson(
        DROPBOX_ENDPOINTS.createFolder,
        { path: remotePath(parentId, name), autorename: false },
        '创建 Dropbox 目录',
        send,
        token,
        signal
      );
      const metadata = (payload.metadata ?? {}) as DropboxEntry;

      return toEntry({ ...metadata, '.tag': 'folder', name: metadata.name ?? name });
    },

    async upload({ credential, parentId, name, bytes, signal }) {
      if (bytes.byteLength > DROPBOX_SIMPLE_UPLOAD_LIMIT) {
        throw new Error(
          `归档 ${formatMB(bytes.byteLength)} 超过 Dropbox 单次上传上限 ${formatMB(DROPBOX_SIMPLE_UPLOAD_LIMIT)}；` +
            '可在云端手动上传该文件，或在作品里分离大附件后重试'
        );
      }

      const token = await accessTokenFor(credential, signal);
      const response = await send(DROPBOX_ENDPOINTS.upload, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
          'dropbox-api-arg': dropboxArg({
            path: remotePath(parentId, name),
            // add + autorename：同秒重名时由服务商改名，绝不覆盖云端已有内容。
            mode: 'add',
            autorename: true,
            mute: true
          })
        },
        body: binaryBody(bytes),
        signal: signal as AbortSignal | undefined
      });

      return toEntry((await readPayload(response, '上传归档')) as DropboxEntry);
    },

    async download({ credential, fileId, signal }) {
      const token = await accessTokenFor(credential, signal);
      const response = await send(DROPBOX_ENDPOINTS.download, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'dropbox-api-arg': dropboxArg({ path: remotePath(fileId) })
        },
        signal
      });

      if (!response.ok) {
        // 下载成功的响应体是文件本身，读不了 JSON；只有失败时才可能是 JSON 错误体。
        throw new Error(`下载归档失败（HTTP ${response.status}）：${summarizeFailure(await response.text())}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    },

    async quota({ credential, signal }): Promise<CloudQuota | null> {
      const token = await accessTokenFor(credential, signal);
      const payload = await postJson(DROPBOX_ENDPOINTS.spaceUsage, null, '读取 Dropbox 配额', send, token, signal);
      const allocation = (payload.allocation ?? {}) as { allocated?: unknown };
      const used = typeof payload.used === 'number' ? payload.used : null;
      const total = typeof allocation.allocated === 'number' ? allocation.allocated : null;

      return used === null || total === null ? null : { usedBytes: used, totalBytes: total };
    },

    async remove({ credential, entryId, signal }) {
      const token = await accessTokenFor(credential, signal);

      await postJson(DROPBOX_ENDPOINTS.remove, { path: remotePath(entryId) }, '删除云端归档', send, token, signal);
    }
  };

  async function listPage(
    body: Record<string, unknown>,
    action: string,
    token: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const url = 'cursor' in body ? DROPBOX_ENDPOINTS.listFolderContinue : DROPBOX_ENDPOINTS.listFolder;

    return postJson(url, body, action, send, token, signal);
  }
}

/**
 * 目录树用路径当标识，所以这里统一把父目录拼成远端路径；'' 表示最顶层。
 *
 * 名字里出现斜杠会被当成新的一层，直接拒绝：备份侧的命名规则已经清洗过，
 * 能走到这里说明调用方传了不该传的东西。
 */
function remotePath(parentId: string | null | undefined, name?: string): string {
  const base = parentId ?? '';

  if (name === undefined) {
    return base;
  }

  if (!name || name.includes('/')) {
    throw new Error(`远端名称不合法：${name || '(空)'}`);
  }

  return `${base}/${name}`;
}

/**
 * 目录标识统一用路径而不是 Dropbox 的 id。
 *
 * 路径能自上而下推导（`/a/b` 的上一级就是 `/a`），面包屑与"返回上一级"不必额外维护父指针链；
 * 代价是目录改名会让已展开的列表失效——浏览目录的是一个正盯着屏幕的人，这个代价可以接受。
 */
function describeFolder(path: string) {
  if (!path) {
    return { id: null, name: '应用文件夹', root: true };
  }

  return { id: path, name: path.slice(path.lastIndexOf('/') + 1), root: false };
}

/** 上一级；null 表示上一级就是最顶层。 */
function parentOf(path: string): string | null {
  const index = path.lastIndexOf('/');

  return index <= 0 ? null : path.slice(0, index);
}

function toEntry(entry: DropboxEntry): CloudRemoteEntry {
  const name = entry.name ?? '';

  if (entry['.tag'] === 'folder') {
    return { id: entry.path_display ?? entry.path_lower ?? `/${name}`, name, kind: 'folder' };
  }

  return {
    id: entry.path_display ?? entry.path_lower ?? `/${name}`,
    name,
    kind: 'file',
    ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
    ...(entry.server_modified ? { modifiedAt: entry.server_modified } : {})
  };
}

function readEntries(payload: Record<string, unknown>): DropboxEntry[] {
  return Array.isArray(payload.entries) ? (payload.entries as DropboxEntry[]) : [];
}

function readCursor(payload: Record<string, unknown>): string | null {
  if (payload.has_more !== true) {
    return null;
  }

  return requireString(payload.cursor, 'Dropbox 未返回分页游标');
}

function readCredential(credential: CloudCredential): DropboxCredential {
  const refreshToken = credential.refreshToken;

  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('Dropbox 凭据缺少 refresh token，请重新登录');
  }

  return { refreshToken };
}

function displayNameOf(account: Record<string, unknown>): string {
  const name = account.name as { display_name?: unknown } | undefined;

  if (typeof name?.display_name === 'string' && name.display_name) {
    return name.display_name;
  }

  return typeof account.email === 'string' && account.email ? account.email : 'Dropbox 账号';
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(message);
  }

  return value;
}

function formatMB(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * 把 API 参数编成 **纯 ASCII** 的 JSON。
 *
 * HTTP 头只能装 ByteString，而作品名与设备名里几乎一定有中文。
 * `JSON.stringify` 默认保留原字符，`拾` 这种字符一到 `Headers` 就会抛
 * `Cannot convert argument to a ByteString`。转成 `\uXXXX` 转义后仍是合法 JSON，
 * 服务端解出来还是原名。
 */
function dropboxArg(value: unknown): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/**
 * 把二进制原样交给 fetch。
 *
 * Node 的 fetch 本来就接受 Uint8Array，但类型定义里的 ArrayBufferView 带 ArrayBufferLike 泛型参数，
 * 直接传会被判为不匹配。这里只收一次窄，**不做数据拷贝**：150 MB 上限下多拷一份很吃亏。
 */
function binaryBody(bytes: Uint8Array): NonNullable<RequestInit['body']> {
  return bytes as unknown as NonNullable<RequestInit['body']>;
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  action: string,
  send: DropboxFetch,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const response = await send(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    signal
  });

  return readPayload(response, action);
}

async function postJson(
  url: string,
  body: unknown,
  action: string,
  send: DropboxFetch,
  accessToken: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const response = await send(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  return readPayload(response, action);
}

async function readPayload(response: Response, action: string): Promise<Record<string, unknown>> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${action}失败（HTTP ${response.status}）：${summarizeFailure(text)}`);
  }

  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** Dropbox 的错误体是 JSON；取 error_summary 给作者看，取不到就截断原文。 */
function summarizeFailure(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error_summary?: unknown };

    if (typeof parsed.error_summary === 'string' && parsed.error_summary) {
      return parsed.error_summary;
    }
  } catch {
    // 非 JSON 错误体按原文截断，不进 JSON.parse 分支。
  }

  return text.slice(0, 300) || '无响应内容';
}
