import type { Static } from 'typebox';

import type {
  ChaptaleStorageModeSchema,
  PiWebAccessProviderSchema,
  PiWebAccessWorkflowSchema,
  UpdateChaptaleSettingsPayloadSchema,
  UpdatePiWebAccessSettingsPayloadSchema
} from './schemas/settings';

export type ChaptaleStorageMode = Static<typeof ChaptaleStorageModeSchema>;

/** 会话存储策略；workspacePath 只在 workspace 模式下生效。 */
export type ChaptaleStorageSettings = {
  mode: ChaptaleStorageMode;
  workspacePath?: string;
};

export type PiWebAccessProvider = Static<typeof PiWebAccessProviderSchema>;

export type PiWebAccessWorkflow = Static<typeof PiWebAccessWorkflowSchema>;

/** Chaptale 使用的完整 Web Access 设置快照；更新 payload 则允许只提交部分字段。 */
export type PiWebAccessSettings = {
  webSearchEnabled: boolean;
  provider: PiWebAccessProvider;
  workflow: PiWebAccessWorkflow;
  openaiApiKey?: string;
  braveApiKey?: string;
  exaApiKey?: string;
  parallelApiKey?: string;
  tavilyApiKey?: string;
  perplexityApiKey?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  cloudflareApiKey?: string;
  allowBrowserCookies: boolean;
  chromeProfile?: string;
  searchModel?: string;
  summaryModel?: string;
  curatorTimeoutSeconds: number;
  githubClone: {
    enabled: boolean;
    maxRepoSizeMB: number;
    cloneTimeoutSeconds: number;
    clonePath?: string;
  };
  youtube: {
    enabled: boolean;
    preferredModel?: string;
  };
  video: {
    enabled: boolean;
    preferredModel?: string;
    maxSizeMB: number;
  };
  ssrf?: {
    allowRanges: string[];
  };
};

export type ChaptaleSettings = {
  version: 1;
  storage: ChaptaleStorageSettings;
  /** 应用关闭前最后打开的会话；不存在或已删除时由 Renderer 回退。 */
  lastSessionId?: string;
};

export type ChaptaleSettingsPaths = {
  rootDir: string;
  agentDir: string;
  settingsPath: string;
  piSettingsPath: string;
  piModelsPath: string;
  piAuthPath: string;
  piWebAccessConfigPath: string;
  sessionsRootDir: string;
  effectiveSessionDir: string;
  /** Renderer 绑定会话时使用的权威 cwd；避免前端自行推导 workspace 安全边界。 */
  currentCwd: string;
};

export type ChaptaleSettingsState = {
  /** Chaptale 应用自身设置，持久化到 settings.json。 */
  settings: ChaptaleSettings;
  /** pi-web-access 设置，持久化到 web-search.json。 */
  webAccess: PiWebAccessSettings;
  paths: ChaptaleSettingsPaths;
};

export type UpdatePiWebAccessSettingsPayload = Static<typeof UpdatePiWebAccessSettingsPayloadSchema>;

/** `lastSessionId` 传 null 表示清除已记忆的会话。 */
export type UpdateChaptaleSettingsPayload = Static<typeof UpdateChaptaleSettingsPayloadSchema>;

export type SelectWorkspaceDirResult = {
  canceled: boolean;
  workspacePath?: string;
  state?: ChaptaleSettingsState;
};
