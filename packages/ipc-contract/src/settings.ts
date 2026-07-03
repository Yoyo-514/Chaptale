export type ChaptaleStorageMode = 'global' | 'workspace';

export type ChaptaleStorageSettings = {
  mode: ChaptaleStorageMode;
  workspacePath?: string;
};

export type ChaptaleLlmSettings = {
  providerId?: string;
  modelId?: string;
};

export type ChaptaleSettings = {
  version: 1;
  storage: ChaptaleStorageSettings;
  llm: ChaptaleLlmSettings;
};

export type ChaptaleSettingsPaths = {
  rootDir: string;
  agentDir: string;
  settingsPath: string;
  piSettingsPath: string;
  piModelsPath: string;
  piAuthPath: string;
  sessionsRootDir: string;
  effectiveSessionDir: string;
};

export type ChaptaleSettingsState = {
  settings: ChaptaleSettings;
  paths: ChaptaleSettingsPaths;
};

export type UpdateChaptaleSettingsPayload = {
  storage?: Partial<ChaptaleStorageSettings>;
  llm?: Partial<ChaptaleLlmSettings>;
};

export type SelectWorkspaceDirResult = {
  canceled: boolean;
  workspacePath?: string;
  state?: ChaptaleSettingsState;
};
