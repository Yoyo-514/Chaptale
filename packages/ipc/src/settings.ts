import type { Static } from 'typebox';
import type {
  ChaptaleStorageModeSchema,
  PiWebAccessProviderSchema,
  PiWebAccessWorkflowSchema,
  UpdateChaptaleSettingsPayloadSchema,
  UpdatePiWebAccessSettingsPayloadSchema
} from './schemas/settings';

export type ChaptaleStorageMode = Static<typeof ChaptaleStorageModeSchema>;

export type ChaptaleStorageSettings = {
  mode: ChaptaleStorageMode;
  workspacePath?: string;
};

export type PiWebAccessProvider = Static<typeof PiWebAccessProviderSchema>;

export type PiWebAccessWorkflow = Static<typeof PiWebAccessWorkflowSchema>;

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
