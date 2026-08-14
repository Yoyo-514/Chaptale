import { klona } from 'klona';
import path from 'node:path';

import type { WebToolsProvider, WebToolsSettings } from '@chaptale/ipc-contract';
import { isRecord, readBoolean, readFiniteNumber, readString, readStringArray } from '@chaptale/shared';

import { readJsonFile, writeJsonFile } from '../../infra/filesystem/files';

/** web 工具配置文件名；位于 agentDir 下，与 models.json 同级。 */
export const WEB_TOOLS_CONFIG_FILENAME = 'web-tools.json';

export type { WebToolsProvider, WebToolsSettings };

export const DEFAULT_WEB_TOOLS_SETTINGS: WebToolsSettings = {
  search: { enabled: true, provider: 'duckduckgo' },
  keys: {},
  fetch: { timeoutSeconds: 30, maxBytes: 2 * 1024 * 1024 },
  ssrf: { allowRanges: [] }
};

export type WebToolsSettingsStoreOptions = {
  /** web-tools.json 的完整路径。 */
  configPath: string;
};

/**
 * web-tools.json 的持久化边界。
 *
 * 读取宽松（未知字段忽略、缺省字段回填默认值），写入完整；坏文件时返回默认配置
 * 并在下次保存时整体重建，不让配置错误拖垮工具调用。
 */
export class WebToolsSettingsStore {
  constructor(private readonly options: WebToolsSettingsStoreOptions) {}

  get configPath(): string {
    return this.options.configPath;
  }

  async read(): Promise<WebToolsSettings> {
    const raw = await readJsonFile(this.options.configPath);

    return raw === undefined ? klona(DEFAULT_WEB_TOOLS_SETTINGS) : normalizeSettings(raw);
  }

  async write(settings: WebToolsSettings): Promise<void> {
    await writeJsonFile(this.options.configPath, { version: 1, ...settings });
  }

  /** 读-改-写串行化由设置服务层负责；此方法只做单次合并保存。 */
  async update(mutator: (current: WebToolsSettings) => WebToolsSettings): Promise<WebToolsSettings> {
    const next = mutator(await this.read());
    await this.write(next);
    return next;
  }

  static configPathFor(agentDir: string): string {
    return path.join(agentDir, WEB_TOOLS_CONFIG_FILENAME);
  }
}

/** 将任意输入规整为完整配置；仅提取已知键，类型不符的字段回退默认值。 */
export function normalizeSettings(raw: unknown): WebToolsSettings {
  const record = isRecord(raw) ? raw : {};
  const search = isRecord(record.search) ? record.search : {};
  const keys = isRecord(record.keys) ? record.keys : {};
  const fetch = isRecord(record.fetch) ? record.fetch : {};
  const ssrf = isRecord(record.ssrf) ? record.ssrf : {};
  const provider = readString(search.provider);

  return {
    search: {
      enabled: readBoolean(search.enabled) ?? DEFAULT_WEB_TOOLS_SETTINGS.search.enabled,
      provider: isWebToolsProvider(provider) ? provider : DEFAULT_WEB_TOOLS_SETTINGS.search.provider
    },
    keys: {
      braveApiKey: readOptionalNonEmpty(keys.braveApiKey),
      tavilyApiKey: readOptionalNonEmpty(keys.tavilyApiKey),
      exaApiKey: readOptionalNonEmpty(keys.exaApiKey)
    },
    fetch: {
      timeoutSeconds: readFiniteNumber(fetch.timeoutSeconds) ?? DEFAULT_WEB_TOOLS_SETTINGS.fetch.timeoutSeconds,
      maxBytes: readFiniteNumber(fetch.maxBytes) ?? DEFAULT_WEB_TOOLS_SETTINGS.fetch.maxBytes
    },
    ssrf: {
      allowRanges: readStringArray(ssrf.allowRanges) ?? []
    }
  };
}

function isWebToolsProvider(value: unknown): value is WebToolsProvider {
  return value === 'duckduckgo' || value === 'brave' || value === 'tavily' || value === 'exa';
}

/** 空字符串视为未配置，统一收敛为 undefined，避免把空 key 发给服务端。 */
function readOptionalNonEmpty(value: unknown): string | undefined {
  const text = readString(value);
  return text && text.trim() ? text.trim() : undefined;
}
