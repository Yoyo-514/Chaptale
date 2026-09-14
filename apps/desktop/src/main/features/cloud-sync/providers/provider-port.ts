import type { CloudProvider } from '@chaptale/ipc-contract';

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

/**
 * 远端条目。
 *
 * `kind` 由适配器填，消费方按需要过滤：目录选择器只取 folder，备份清单只取 file。
 * 端口给出完整清单而不是两个专用方法，是因为远端只有"列目录"这一种操作——
 * 拆成两套只会让每个适配器各写一遍同样的分页与映射。
 */
export type CloudRemoteEntry = {
  /** 服务商侧标识；目录树里最顶层为 null。 */
  id: string | null;
  name: string;
  kind: 'file' | 'folder';
  /** 文件大小（字节）。目录不带此字段。 */
  size?: number;
  /** 服务商侧的修改时间（ISO 8601）；取不到就不填，不用本地时间凑。 */
  modifiedAt?: string;
};

/** 当前所在目录。与 IPC 面的 `CloudRemoteFolder` 同形，服务层直接透传。 */
export type CloudFolderRef = {
  id: string | null;
  name: string;
  root: boolean;
};

export type CloudEntryListing = {
  current: CloudFolderRef;
  /** 上一级；null 表示上一级就是最顶层。 */
  parentId: string | null;
  entries: CloudRemoteEntry[];
};

/** 服务商配额。查不到（服务商没有接口，或这次读失败）就返回 null，而不是编一个数。 */
export type CloudQuota = {
  usedBytes: number;
  totalBytes: number;
};

/**
 * 服务商适配端口。
 *
 * 备份只上传新归档；remove 仅供作者明确确认的批量删除使用，自动备份不调用它。
 */
export type CloudProviderAdapter = {
  id: CloudProvider;
  /**
   * 服务商返回的最顶层是否已是本应用的专属区域（App Folder 接入）。
   * 绑定最顶层时据此决定要不要再套一层容器目录。
   */
  readonly topLevelIsAppScoped: boolean;
  /** 未内置 clientId 时返回 null：界面只显示配置说明，不提供登录入口。 */
  oauth(): CloudOAuthConfig | null;
  /** 用授权码换凭据，并返回账号展示信息。 */
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<{ credential: CloudCredential; profile: CloudAccountProfile }>;
  /** 列一个目录下的直接子项；`parentId` 省略或 null 表示最顶层。 */
  listEntries(input: {
    credential: CloudCredential;
    parentId?: string | null;
    signal?: AbortSignal;
  }): Promise<CloudEntryListing>;
  /** 建目录；同名目录已存在时按失败处理，由调用方决定是否复用。 */
  createFolder(input: {
    credential: CloudCredential;
    parentId: string | null;
    name: string;
    signal?: AbortSignal;
  }): Promise<CloudRemoteEntry>;
  /** 上传单个文件；同名文件由服务商改名，不覆盖既有内容。 */
  upload(input: {
    credential: CloudCredential;
    parentId: string | null;
    name: string;
    bytes: Uint8Array;
    signal?: AbortSignal;
  }): Promise<CloudRemoteEntry>;
  download(input: { credential: CloudCredential; fileId: string; signal?: AbortSignal }): Promise<Uint8Array>;
  quota(input: { credential: CloudCredential; signal?: AbortSignal }): Promise<CloudQuota | null>;
  /**
   * 删除一个远端文件。
   *
   * **只服务于作者显式确认的清理动作**（删掉某个云备份）。应用不做任何自动清理，
   * 所以这个方法只有一个人口：作者在面板上勾选并二次确认过的那一次。
   */
  remove(input: { credential: CloudCredential; entryId: string; signal?: AbortSignal }): Promise<void>;
};
