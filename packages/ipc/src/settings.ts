import type { Static } from 'typebox';

import type {
  ChaptaleStorageModeSchema,
  UpdateChaptaleSettingsPayloadSchema,
  UpdateWebToolsSettingsPayloadSchema,
  WebToolsProviderSchema
} from './schemas/settings';

export type ChaptaleStorageMode = Static<typeof ChaptaleStorageModeSchema>;

/** 会话存储策略；workspacePath 只在 workspace 模式下生效。 */
export type ChaptaleStorageSettings = {
  mode: ChaptaleStorageMode;
  workspacePath?: string;
};

export type WebToolsProvider = Static<typeof WebToolsProviderSchema>;

/** 聊天联网能力设置快照；更新 payload 允许只提交部分字段。 */
export type WebToolsSettings = {
  search: {
    /** 聊天输入框的联网开关；关闭后 web_search 报错提示，fetch/get 不受影响。 */
    enabled: boolean;
    provider: WebToolsProvider;
  };
  keys: {
    braveApiKey?: string;
    tavilyApiKey?: string;
    exaApiKey?: string;
  };
  fetch: {
    timeoutSeconds: number;
    maxBytes: number;
  };
  ssrf: {
    allowRanges: string[];
  };
};

export type ChaptaleSettings = {
  version: 1;
  storage: ChaptaleStorageSettings;
  /**
   * 按存储域记忆的最近会话（global 槽 + 每工作区一槽）。
   * 落盘字段；lastSessionId 为按当前域合成的视图。
   */
  lastSessions?: Record<string, string>;
  /** 当前存储域的最近会话（合成值，不落盘）；不存在或已删除时由 Renderer 回退。 */
  lastSessionId?: string;
};

export type ChaptaleSettingsPaths = {
  rootDir: string;
  agentDir: string;
  settingsPath: string;
  modelsPath: string;
  webToolsConfigPath: string;
  sessionsRootDir: string;
  effectiveSessionDir: string;
  /** Renderer 绑定会话时使用的权威 cwd；避免前端自行推导 workspace 安全边界。 */
  currentCwd: string;
};

export type ChaptaleSettingsState = {
  /** Chaptale 应用自身设置，持久化到 settings.json。 */
  settings: ChaptaleSettings;
  /** 联网能力设置，持久化到 web-tools.json。 */
  webTools: WebToolsSettings;
  paths: ChaptaleSettingsPaths;
};

export type UpdateWebToolsSettingsPayload = Static<typeof UpdateWebToolsSettingsPayloadSchema>;

/** `lastSessionId` 传 null 表示清除已记忆的会话。 */
export type UpdateChaptaleSettingsPayload = Static<typeof UpdateChaptaleSettingsPayloadSchema>;

export type SelectWorkspaceDirResult = {
  canceled: boolean;
  workspacePath?: string;
  state?: ChaptaleSettingsState;
};
