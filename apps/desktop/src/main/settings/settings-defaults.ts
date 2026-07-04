import type { ChaptaleSettings } from '@chaptale/ipc-contract';

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: ChaptaleSettings = {
  version: SETTINGS_VERSION,
  storage: {
    mode: 'global'
  },
  llm: {}
};

export function cloneDefaultSettings(): ChaptaleSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as ChaptaleSettings;
}

export function mergeSettings(value: Partial<ChaptaleSettings> | undefined): ChaptaleSettings {
  return {
    ...cloneDefaultSettings(),
    ...value,
    version: SETTINGS_VERSION,
    storage: {
      ...DEFAULT_SETTINGS.storage,
      ...value?.storage
    },
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...value?.llm
    }
  };
}
