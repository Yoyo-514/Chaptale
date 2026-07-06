export type ChaptaleStorageMode = 'global' | 'workspace';

export type ChaptaleStorageSettings = {
  mode: ChaptaleStorageMode;
  workspacePath?: string;
};

export type ChaptaleLlmSettings = {
  providerId?: string;
  modelId?: string;
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
  llm: ChaptaleLlmSettings;
  webAccess: PiWebAccessSettings;
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
  settings: ChaptaleSettings;
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
  llm?: Partial<ChaptaleLlmSettings>;
  webAccess?: UpdatePiWebAccessSettingsPayload;
};

export type SelectWorkspaceDirResult = {
  canceled: boolean;
  workspacePath?: string;
  state?: ChaptaleSettingsState;
};
