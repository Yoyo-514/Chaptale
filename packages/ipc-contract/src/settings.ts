export type ChaptaleStorageMode = 'global' | 'workspace';

export type ChaptaleStorageSettings = {
  mode: ChaptaleStorageMode;
  workspacePath?: string;
};

export type PiWebAccessProvider = 'auto' | 'openai' | 'brave' | 'parallel' | 'tavily' | 'exa' | 'perplexity' | 'gemini';

export type PiWebAccessWorkflow = 'none' | 'auto-summary' | 'summary-review';

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

export type UpdatePiWebAccessSettingsPayload = Partial<
  Omit<PiWebAccessSettings, 'githubClone' | 'youtube' | 'video' | 'ssrf'>
> & {
  githubClone?: Partial<PiWebAccessSettings['githubClone']>;
  youtube?: Partial<PiWebAccessSettings['youtube']>;
  video?: Partial<PiWebAccessSettings['video']>;
  ssrf?: Partial<PiWebAccessSettings['ssrf']>;
};

export type UpdateChaptaleSettingsPayload = {
  storage?: Partial<ChaptaleStorageSettings>;
  /** 传 null 表示清除已记忆的会话。 */
  lastSessionId?: string | null;
};

export type SelectWorkspaceDirResult = {
  canceled: boolean;
  workspacePath?: string;
  state?: ChaptaleSettingsState;
};
