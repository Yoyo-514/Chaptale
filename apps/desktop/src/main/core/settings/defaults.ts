import { klona } from 'klona';

import type { ChaptaleSettings, UpdateWebToolsSettingsPayload, WebToolsSettings } from '@chaptale/ipc-contract';
import { isChaptaleTheme } from '@chaptale/ipc-contract';

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
  },
  // 与 Renderer 的 index.html 上那个静态主题类必须一致：
  // 两者不一致时每次冷启动都会先画一帧再跳色。
  theme: 'dark'
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
 * 顶层 lastSessionId 不落盘（由 getState 按域合成），只清洗按域槽位。
 */
export function mergeSettings(value: Partial<ChaptaleSettings> | undefined): ChaptaleSettings {
  const lastSessions = sanitizeLastSessionSlots(value?.lastSessions);

  return {
    version: SETTINGS_VERSION,
    storage: {
      ...DEFAULT_SETTINGS.storage,
      ...value?.storage
    },
    // 认不出的主题回落默认，而不是原样透传：这个值最终会变成 <html> 上的类名，
    // 落一个没有对应样式的类，界面会退化成没有任何语义色的裸样式。
    theme: isChaptaleTheme(value?.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    ...(Object.keys(lastSessions).length > 0 ? { lastSessions } : {})
  };
}

/** 清洗按域槽位：仅保留非空字符串。 */
function sanitizeLastSessionSlots(raw: unknown): Record<string, string> {
  const slots: Record<string, string> = {};

  if (raw && typeof raw === 'object') {
    for (const [domainKey, sessionId] of Object.entries(raw)) {
      if (typeof sessionId === 'string' && sessionId) {
        slots[domainKey] = sessionId;
      }
    }
  }

  return slots;
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
