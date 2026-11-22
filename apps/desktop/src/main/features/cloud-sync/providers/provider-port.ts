import type { CloudProvider } from '../../../../bridge/cloud-sync';

/**
 * 服务商授权配置。
 *
 * `redirectPort` 必须固定：Dropbox 要求重定向 URI 与 App Console 登记值精确匹配，
 * 端口随机会直接授权失败。传 0 只对允许 `http://localhost` 通配的服务商（如 Entra）成立。
 */
export type CloudOAuthConfig = {
  clientId: string;
  authorizeEndpoint: string;
  scopes: string[];
  redirectPort: number;
  /**
   * 回调地址。
   *
   * 同一个 URI 要在授权请求与换令牌两处**逐字符一致**，而各家对主机名与末尾斜杠的要求并不一样，
   * 所以由适配器给一个构造器，而不是让流程拼一个“通用形状”：
   *
   * - Dropbox：App Console 登记的串要逐字符相同，主机用 `127.0.0.1`；
   * - Entra：门户不接受 `http://127.0.0.1`（只能改应用清单），要写 `localhost`，
   *   而回环地址的端口在匹配时被忽略（RFC 8252 §7.3），所以那边可以用随机端口。
   */
  redirectUri: (port: number) => string;
  extraAuthorizeParams?: Record<string, string>;
};

/** 凭据载荷。字段由各服务商自定，只有对应适配器读得懂；落盘前整体加密。 */
export type CloudCredential = Record<string, unknown>;

/** 服务商侧账号标识，仅用于界面显示。 */
export type CloudAccountProfile = {
  displayName: string;
};

/** 应用专属目录顶层的一个条目。作者可能自己往里放目录，所以带 `kind`，备份清单只取 file。 */
export type CloudRemoteEntry = {
  /** 服务商侧标识：Dropbox 用路径，OneDrive 用 id。 */
  id: string;
  name: string;
  kind: 'file' | 'folder';
  /** 文件大小（字节）。目录不带此字段。 */
  size?: number;
  /** 服务商侧的修改时间（ISO 8601）；取不到就不填，不用本地时间凑。 */
  modifiedAt?: string;
};

/** 服务商适配端口。两家都按 App Folder 接入，所有操作只在应用专属目录的顶层。 */
export type CloudProviderAdapter = {
  id: CloudProvider;
  /** 未内置 clientId 时返回 null：界面只显示配置说明，不提供登录入口。 */
  oauth(): CloudOAuthConfig | null;
  /** 用授权码换凭据，并返回账号展示信息。 */
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<{ credential: CloudCredential; profile: CloudAccountProfile }>;
  /** 列出应用专属目录顶层的全部条目。 */
  listEntries(input: { credential: CloudCredential; signal?: AbortSignal }): Promise<CloudRemoteEntry[]>;
  /** 上传单个文件；同名文件由服务商改名，不覆盖既有内容。 */
  upload(input: {
    credential: CloudCredential;
    name: string;
    bytes: Uint8Array;
    signal?: AbortSignal;
  }): Promise<CloudRemoteEntry>;
  download(input: { credential: CloudCredential; fileId: string; signal?: AbortSignal }): Promise<Uint8Array>;
  /** 删除一个远端文件。 */
  remove(input: { credential: CloudCredential; entryId: string; signal?: AbortSignal }): Promise<void>;
};
