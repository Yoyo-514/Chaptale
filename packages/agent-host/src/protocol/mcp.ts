export type McpConfigScope = 'global' | 'work';

export type McpSelectableExposure = 'codemode' | 'deferred' | 'direct';

export type McpExposureView = McpSelectableExposure | 'hidden';

export type McpServerState = 'disabled' | 'connecting' | 'connected' | 'needs-auth' | 'failed';

export interface McpToolSummary {
  name: string;
  description?: string;
}

export interface McpSignInPendingView {
  authorizationUrl: string;
}

export interface ManagedMcpServerView {
  name: string;
  /** 定义该服务底层连接参数的文件层级。 */
  definedIn: McpConfigScope;
  /** 当前作品是否通过轻量覆盖修改了全局服务的 enabled 或 exposure。 */
  overriddenInWork?: boolean;
  transport: 'stdio' | 'http';
  /** 连接目标摘要（命令或 URL，不含密钥）。 */
  endpoint: string;
  description?: string;
  enabled: boolean;
  exposure: McpExposureView;
  state: McpServerState;
  error?: string;
  tools: McpToolSummary[];
  hasResources: boolean;
  usesOAuth: boolean;
  hasStoredAuth: boolean;
  /** 正在等待浏览器回调或手动粘贴重定向 URL 时存在。 */
  signingIn?: McpSignInPendingView;
}

export interface ManagedMcpSnapshot {
  globalFile: string;
  globalJson: string;
  globalErrors: string[];
  workId: string | null;
  workFile: string | null;
  workJson: string | null;
  workErrors: string[];
  /** 合并后的有效服务列表（未指定作品时为全局服务；指定作品时为全局与作品合并结果）。 */
  servers: ManagedMcpServerView[];
}
