import { klona } from 'klona';

import type { ChaptaleSettings, UpdateWebToolsSettingsPayload, WebToolsSettings } from '@chaptale/ipc-contract';

export const SETTINGS_VERSION = 1;

export const DEFAULT_WEB_TOOLS_SETTINGS: WebToolsSettings = {
  search: { enabled: true, provider: 'duckduckgo' },
  keys: {},
  fetch: { timeoutSeconds: 30, maxBytes: 2 * 1024 * 1024 },
  ssrf: { allowRanges: [] }
};

export const DEFAULT_SETTINGS: ChaptaleSettings = {
  version: SETTINGS_VERSION,
  storage: {
    mode: 'global'
  }
};

/** 返回隔离的默认配置，避免调用方修改共享常量后污染后续初始化。 */
export function cloneDefaultSettings(): ChaptaleSettings {
  return klona(DEFAULT_SETTINGS);
}

export function cloneDefaultWebToolsSettings(): WebToolsSettings {
  return klona(DEFAULT_WEB_TOOLS_SETTINGS);
}

/**
 * 根据磁盘内容重建当前版本的应用设置顶层结构，并为 storage 补齐默认值。
 * 这样旧配置缺少存储字段时仍可读取，同时统一写出当前 SETTINGS_VERSION。
 */
export function mergeSettings(value: Partial<ChaptaleSettings> | undefined): ChaptaleSettings {
  return {
    version: SETTINGS_VERSION,
    storage: {
      ...DEFAULT_SETTINGS.storage,
      ...value?.storage
    },
    ...(value?.lastSessionId ? { lastSessionId: value.lastSessionId } : {})
  };
}

/**
 * 嵌套分组合并联网设置；未提交的分组保持现值，使部分更新不会覆盖其余选项。
 */
export function mergeWebToolsSettings(
  current: WebToolsSettings,
  payload: UpdateWebToolsSettingsPayload
): WebToolsSettings {
  return {
    search: {
      ...current.search,
      ...payload.search
    },
    keys: {
      ...current.keys,
      ...payload.keys
    },
    fetch: {
      ...current.fetch,
      ...payload.fetch
    },
    ssrf: {
      ...current.ssrf,
      ...payload.ssrf
    }
  };
}
