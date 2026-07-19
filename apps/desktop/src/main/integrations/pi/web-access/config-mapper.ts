import type { PiWebAccessSettings, UpdatePiWebAccessSettingsPayload } from '@chaptale/ipc-contract';
import {
  blankToUndefined,
  isRecord,
  readBoolean,
  readFiniteNumber,
  readString,
  readStringArray,
  stripUndefined
} from '@chaptale/shared';

import { mergeWebAccessSettings } from '../../../modules/settings/defaults';
import type { WebAccessAdapter } from '../../../modules/settings/web-access-adapter';

/** 将稳定的设置模块端口适配到 Pi web-search.json 配置格式。 */
export class PiWebAccessAdapter implements WebAccessAdapter {
  fromConfig(config: Record<string, unknown>): UpdatePiWebAccessSettingsPayload {
    return fromPiWebAccessConfig(config);
  }

  mergeUpdate(current: PiWebAccessSettings, payload: UpdatePiWebAccessSettingsPayload): PiWebAccessSettings {
    return mergeWebAccessUpdate(current, payload);
  }

  toConfig(settings: PiWebAccessSettings): Record<string, unknown> {
    return toPiWebAccessConfig(settings);
  }
}

/**
 * 宽松读取 pi web-search.json，只从已知键提取字符串、布尔值、有限数值和字符串数组。
 * 此处不校验枚举值或业务范围；缺失及基础类型不匹配的字段由设置默认值层补齐。
 */
export function fromPiWebAccessConfig(config: Record<string, unknown>): UpdatePiWebAccessSettingsPayload {
  const webSearch = readObject(config.webSearch);
  const githubClone = readObject(config.githubClone);
  const youtube = readObject(config.youtube);
  const video = readObject(config.video);
  const ssrf = readObject(config.ssrf);

  return {
    webSearchEnabled: readBoolean(webSearch.enabled),
    provider: readString(config.provider) as PiWebAccessSettings['provider'] | undefined,
    workflow: readString(config.workflow) as PiWebAccessSettings['workflow'] | undefined,
    openaiApiKey: readString(config.openaiApiKey),
    braveApiKey: readString(config.braveApiKey),
    exaApiKey: readString(config.exaApiKey),
    parallelApiKey: readString(config.parallelApiKey),
    tavilyApiKey: readString(config.tavilyApiKey),
    perplexityApiKey: readString(config.perplexityApiKey),
    geminiApiKey: readString(config.geminiApiKey),
    geminiBaseUrl: readString(config.geminiBaseUrl),
    cloudflareApiKey: readString(config.cloudflareApiKey),
    allowBrowserCookies: readBoolean(config.allowBrowserCookies),
    chromeProfile: readString(config.chromeProfile),
    searchModel: readString(config.searchModel),
    summaryModel: readString(config.summaryModel),
    curatorTimeoutSeconds: readFiniteNumber(config.curatorTimeoutSeconds),
    githubClone: {
      enabled: readBoolean(githubClone.enabled),
      maxRepoSizeMB: readFiniteNumber(githubClone.maxRepoSizeMB),
      cloneTimeoutSeconds: readFiniteNumber(githubClone.cloneTimeoutSeconds),
      clonePath: readString(githubClone.clonePath)
    },
    youtube: {
      enabled: readBoolean(youtube.enabled),
      preferredModel: readString(youtube.preferredModel)
    },
    video: {
      enabled: readBoolean(video.enabled),
      preferredModel: readString(video.preferredModel),
      maxSizeMB: readFiniteNumber(video.maxSizeMB)
    },
    ssrf: {
      allowRanges: readStringArray(ssrf.allowRanges)
    }
  };
}

/** 将应用设置写回 pi 配置结构，并移除空字符串与 undefined，避免生成无效认证和路径项。 */
export function toPiWebAccessConfig(settings: PiWebAccessSettings): Record<string, unknown> {
  return stripUndefined({
    openaiApiKey: blankToUndefined(settings.openaiApiKey),
    braveApiKey: blankToUndefined(settings.braveApiKey),
    exaApiKey: blankToUndefined(settings.exaApiKey),
    parallelApiKey: blankToUndefined(settings.parallelApiKey),
    tavilyApiKey: blankToUndefined(settings.tavilyApiKey),
    perplexityApiKey: blankToUndefined(settings.perplexityApiKey),
    geminiApiKey: blankToUndefined(settings.geminiApiKey),
    geminiBaseUrl: blankToUndefined(settings.geminiBaseUrl),
    cloudflareApiKey: blankToUndefined(settings.cloudflareApiKey),
    provider: settings.provider,
    webSearch: {
      enabled: settings.webSearchEnabled
    },
    chromeProfile: blankToUndefined(settings.chromeProfile),
    allowBrowserCookies: settings.allowBrowserCookies,
    searchModel: blankToUndefined(settings.searchModel),
    summaryModel: blankToUndefined(settings.summaryModel),
    workflow: settings.workflow,
    curatorTimeoutSeconds: settings.curatorTimeoutSeconds,
    githubClone: {
      enabled: settings.githubClone.enabled,
      maxRepoSizeMB: settings.githubClone.maxRepoSizeMB,
      cloneTimeoutSeconds: settings.githubClone.cloneTimeoutSeconds,
      clonePath: blankToUndefined(settings.githubClone.clonePath)
    },
    youtube: {
      enabled: settings.youtube.enabled,
      preferredModel: blankToUndefined(settings.youtube.preferredModel)
    },
    video: {
      enabled: settings.video.enabled,
      preferredModel: blankToUndefined(settings.video.preferredModel),
      maxSizeMB: settings.video.maxSizeMB
    },
    ssrf: settings.ssrf
      ? {
          allowRanges: settings.ssrf.allowRanges
        }
      : undefined
  });
}

/**
 * 合并设置页的部分更新；嵌套 provider 配置必须逐层合并，否则单字段保存会覆盖同组的其余选项。
 */
export function mergeWebAccessUpdate(
  current: PiWebAccessSettings,
  payload: UpdatePiWebAccessSettingsPayload
): PiWebAccessSettings {
  return mergeWebAccessSettings({
    ...current,
    ...payload,
    githubClone: {
      ...current.githubClone,
      ...payload.githubClone
    },
    youtube: {
      ...current.youtube,
      ...payload.youtube
    },
    video: {
      ...current.video,
      ...payload.video
    },
    ssrf: {
      ...current.ssrf,
      ...payload.ssrf
    }
  });
}

function readObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
