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
  // 没有默认作品：首次启动由引导流让作者新建或打开一个。
  workspace: {},
  // 默认藏起 `.chaptale/`：那是应用数据，不是作者的创作资产。
  explorer: {
    showInternalFiles: false
  },
  editor: { autoSave: false },
  onboarding: { completedVersion: 0 },
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
 * 根据磁盘内容重建当前版本的应用设置顶层结构，并为 workspace 补齐默认值。
 * 顶层 lastSessionId 不落盘（由 getState 按当前作品合成），只清洗作品槽位。
 */
export function mergeSettings(value: Partial<ChaptaleSettings> | undefined): ChaptaleSettings {
  const lastSessions = sanitizeLastSessionSlots(value?.lastSessions);
  const workspacePath = value?.workspace?.path;

  return {
    version: SETTINGS_VERSION,
    workspace: typeof workspacePath === 'string' && workspacePath ? { path: workspacePath } : {},
    explorer: {
      ...DEFAULT_SETTINGS.explorer,
      // 只认布尔：手改过的配置里出现 "true"、1 这类值时，落一个非布尔会让开关的勾选态与取数行为对不上。
      ...(typeof value?.explorer?.showInternalFiles === 'boolean'
        ? { showInternalFiles: value.explorer.showInternalFiles }
        : {})
    },
    editor: { autoSave: value?.editor?.autoSave === true },
    onboarding: {
      completedVersion:
        typeof value?.onboarding?.completedVersion === 'number' &&
        Number.isInteger(value.onboarding.completedVersion) &&
        value.onboarding.completedVersion >= 0 &&
        value.onboarding.completedVersion <= 1000
          ? value.onboarding.completedVersion
          : 0
    },
    // 认不出的主题回落默认，而不是原样透传：这个值最终会变成 <html> 上的类名，
    // 落一个没有对应样式的类，界面会退化成没有任何语义色的裸样式。
    theme: isChaptaleTheme(value?.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    ...(Array.isArray(value?.recentWorkspaces)
      ? { recentWorkspaces: value.recentWorkspaces.filter(item => typeof item === 'string').slice(0, 8) }
      : {}),
    ...(Object.keys(lastSessions).length > 0 ? { lastSessions } : {})
  };
}

/** 清洗作品槽位：仅保留作品路径到非空会话 id 的映射。 */
function sanitizeLastSessionSlots(raw: unknown): Record<string, string> {
  const slots: Record<string, string> = {};

  if (raw && typeof raw === 'object') {
    for (const [workspacePath, sessionId] of Object.entries(raw)) {
      if (workspacePath && typeof sessionId === 'string' && sessionId) {
        slots[workspacePath] = sessionId;
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
