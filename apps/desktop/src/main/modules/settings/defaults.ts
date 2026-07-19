import { klona } from 'klona';

import type { ChaptaleSettings, PiWebAccessSettings, UpdatePiWebAccessSettingsPayload } from '@chaptale/ipc-contract';

export const SETTINGS_VERSION = 1;

export const DEFAULT_WEB_ACCESS_SETTINGS: PiWebAccessSettings = {
  webSearchEnabled: true,
  provider: 'auto',
  workflow: 'none',
  allowBrowserCookies: false,
  curatorTimeoutSeconds: 20,
  githubClone: {
    enabled: true,
    maxRepoSizeMB: 350,
    cloneTimeoutSeconds: 30
  },
  youtube: {
    enabled: true,
    preferredModel: 'gemini-3-flash-preview'
  },
  video: {
    enabled: true,
    preferredModel: 'gemini-3-flash-preview',
    maxSizeMB: 50
  },
  ssrf: {
    allowRanges: []
  }
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
 * 按字段合并 Web Access 设置，使新增选项可以在不重写用户密钥和嵌套 provider 配置的情况下获得默认值。
 */
export function mergeWebAccessSettings(value: UpdatePiWebAccessSettingsPayload | undefined): PiWebAccessSettings {
  return {
    webSearchEnabled: value?.webSearchEnabled ?? DEFAULT_WEB_ACCESS_SETTINGS.webSearchEnabled,
    provider: value?.provider ?? DEFAULT_WEB_ACCESS_SETTINGS.provider,
    workflow: value?.workflow ?? DEFAULT_WEB_ACCESS_SETTINGS.workflow,
    openaiApiKey: value?.openaiApiKey ?? DEFAULT_WEB_ACCESS_SETTINGS.openaiApiKey,
    braveApiKey: value?.braveApiKey ?? DEFAULT_WEB_ACCESS_SETTINGS.braveApiKey,
    exaApiKey: value?.exaApiKey ?? DEFAULT_WEB_ACCESS_SETTINGS.exaApiKey,
    parallelApiKey: value?.parallelApiKey ?? DEFAULT_WEB_ACCESS_SETTINGS.parallelApiKey,
    tavilyApiKey: value?.tavilyApiKey ?? DEFAULT_WEB_ACCESS_SETTINGS.tavilyApiKey,
    perplexityApiKey: value?.perplexityApiKey ?? DEFAULT_WEB_ACCESS_SETTINGS.perplexityApiKey,
    geminiApiKey: value?.geminiApiKey ?? DEFAULT_WEB_ACCESS_SETTINGS.geminiApiKey,
    geminiBaseUrl: value?.geminiBaseUrl ?? DEFAULT_WEB_ACCESS_SETTINGS.geminiBaseUrl,
    cloudflareApiKey: value?.cloudflareApiKey ?? DEFAULT_WEB_ACCESS_SETTINGS.cloudflareApiKey,
    allowBrowserCookies: value?.allowBrowserCookies ?? DEFAULT_WEB_ACCESS_SETTINGS.allowBrowserCookies,
    chromeProfile: value?.chromeProfile ?? DEFAULT_WEB_ACCESS_SETTINGS.chromeProfile,
    searchModel: value?.searchModel ?? DEFAULT_WEB_ACCESS_SETTINGS.searchModel,
    summaryModel: value?.summaryModel ?? DEFAULT_WEB_ACCESS_SETTINGS.summaryModel,
    curatorTimeoutSeconds: value?.curatorTimeoutSeconds ?? DEFAULT_WEB_ACCESS_SETTINGS.curatorTimeoutSeconds,
    githubClone: {
      enabled: value?.githubClone?.enabled ?? DEFAULT_WEB_ACCESS_SETTINGS.githubClone.enabled,
      maxRepoSizeMB: value?.githubClone?.maxRepoSizeMB ?? DEFAULT_WEB_ACCESS_SETTINGS.githubClone.maxRepoSizeMB,
      cloneTimeoutSeconds:
        value?.githubClone?.cloneTimeoutSeconds ?? DEFAULT_WEB_ACCESS_SETTINGS.githubClone.cloneTimeoutSeconds,
      clonePath: value?.githubClone?.clonePath ?? DEFAULT_WEB_ACCESS_SETTINGS.githubClone.clonePath
    },
    youtube: {
      enabled: value?.youtube?.enabled ?? DEFAULT_WEB_ACCESS_SETTINGS.youtube.enabled,
      preferredModel: value?.youtube?.preferredModel ?? DEFAULT_WEB_ACCESS_SETTINGS.youtube.preferredModel
    },
    video: {
      enabled: value?.video?.enabled ?? DEFAULT_WEB_ACCESS_SETTINGS.video.enabled,
      preferredModel: value?.video?.preferredModel ?? DEFAULT_WEB_ACCESS_SETTINGS.video.preferredModel,
      maxSizeMB: value?.video?.maxSizeMB ?? DEFAULT_WEB_ACCESS_SETTINGS.video.maxSizeMB
    },
    ssrf: {
      allowRanges: value?.ssrf?.allowRanges ?? DEFAULT_WEB_ACCESS_SETTINGS.ssrf?.allowRanges ?? []
    }
  };
}
