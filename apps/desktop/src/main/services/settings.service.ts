import type {
  ChaptaleSettings,
  ChaptaleSettingsState,
  ChaptaleStorageSettings,
  PiWebAccessSettings,
  UpdateChaptaleSettingsPayload,
  UpdatePiWebAccessSettingsPayload
} from '@chaptale/ipc-contract';
import { blankToUndefined, isRecord, readFiniteNumber, readString, stripUndefined } from '@chaptale/shared';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readJsonFile, writeJsonFile } from '../settings/json-file';
import { cloneDefaultSettings, mergeSettings, mergeWebAccessSettings } from '../settings/settings-defaults';
import { toWorkspaceSessionDirName } from '../settings/workspace-session-dir';

export type SettingsServiceOptions = {
  rootDir?: string;
};

export class SettingsService {
  readonly rootDir: string;
  readonly agentDir: string;
  readonly settingsPath: string;
  readonly piSettingsPath: string;
  readonly piModelsPath: string;
  readonly piAuthPath: string;
  readonly piWebAccessConfigPath: string;
  readonly sessionsRootDir: string;

  // 串行化设置文件的读写，避免多个 IPC handler 并发读写造成竞态。
  private settingsQueue: Promise<unknown> = Promise.resolve();

  constructor(options: SettingsServiceOptions = {}) {
    this.rootDir = options.rootDir ?? path.join(os.homedir(), '.chaptale');
    this.agentDir = path.join(this.rootDir, 'agent');
    this.settingsPath = path.join(this.rootDir, 'settings.json');
    this.piSettingsPath = path.join(this.agentDir, 'settings.json');
    this.piModelsPath = path.join(this.agentDir, 'models.json');
    this.piAuthPath = path.join(this.agentDir, 'auth.json');
    this.piWebAccessConfigPath = path.join(this.agentDir, 'web-search.json');
    this.sessionsRootDir = path.join(this.agentDir, 'sessions');
  }

  async getState(): Promise<ChaptaleSettingsState> {
    const settings = await this.readSettings();
    await this.ensureBaseDirs(settings);

    return {
      settings,
      paths: {
        rootDir: this.rootDir,
        agentDir: this.agentDir,
        settingsPath: this.settingsPath,
        piSettingsPath: this.piSettingsPath,
        piModelsPath: this.piModelsPath,
        piAuthPath: this.piAuthPath,
        piWebAccessConfigPath: this.piWebAccessConfigPath,
        sessionsRootDir: this.sessionsRootDir,
        effectiveSessionDir: this.getSessionDir(settings.storage)
      }
    };
  }

  async update(payload: UpdateChaptaleSettingsPayload): Promise<ChaptaleSettingsState> {
    await this.enqueue(async () => {
      const current = await this.readSettingsUnsafe();
      const next: ChaptaleSettings = {
        ...current,
        storage: {
          ...current.storage,
          ...payload.storage
        },
        llm: {
          ...current.llm,
          ...payload.llm
        },
        webAccess: mergeWebAccessSettings({
          ...current.webAccess,
          ...payload.webAccess
        })
      };

      if (next.storage.mode === 'workspace' && !next.storage.workspacePath) {
        next.storage.mode = 'global';
      }

      await writeJsonFile(this.settingsPath, next);
      await this.writeWebAccessConfig(next.webAccess);
    });

    return this.getState();
  }

  async ensureBaseDirs(settings?: ChaptaleSettings) {
    const resolvedSettings = settings ?? (await this.readSettings());
    await Promise.all([
      fs.mkdir(this.rootDir, { recursive: true }),
      fs.mkdir(this.agentDir, { recursive: true }),
      fs.mkdir(this.sessionsRootDir, { recursive: true }),
      fs.mkdir(this.getSessionDir(resolvedSettings.storage), { recursive: true }),
      fs.mkdir(path.join(this.agentDir, 'global'), { recursive: true })
    ]);

    await this.ensureSettingsFile(resolvedSettings);
  }

  async readSettings(): Promise<ChaptaleSettings> {
    return this.enqueue(() => this.readSettingsUnsafe());
  }

  async ensureSettingsFile(settings?: ChaptaleSettings) {
    // 只在文件缺失时创建默认设置；读路径绝不重写文件，
    // 避免启动时多个 IPC handler 并发触发 “读到半截断文件” 的竞态。
    let webAccessSettings = settings?.webAccess;

    try {
      await fs.access(this.settingsPath);
    } catch {
      const defaults = cloneDefaultSettings();
      await writeJsonFile(this.settingsPath, defaults);
      webAccessSettings = defaults.webAccess;
    }

    await this.ensureWebAccessConfigFile(webAccessSettings ?? cloneDefaultSettings().webAccess);
  }

  async getCurrentSessionDir() {
    const settings = await this.readSettings();
    await this.ensureBaseDirs(settings);
    return this.getSessionDir(settings.storage);
  }

  async getCurrentCwd() {
    const settings = await this.readSettings();

    if (settings.storage.mode === 'workspace' && settings.storage.workspacePath) {
      return settings.storage.workspacePath;
    }

    return path.join(this.agentDir, 'global');
  }

  async getStorageContext() {
    const settings = await this.readSettings();
    return {
      storageMode: settings.storage.mode,
      workspacePath: settings.storage.workspacePath
    };
  }

  getSessionDir(storage: ChaptaleStorageSettings) {
    if (storage.mode === 'workspace' && storage.workspacePath) {
      return path.join(this.sessionsRootDir, toWorkspaceSessionDirName(storage.workspacePath));
    }

    return path.join(this.sessionsRootDir, 'global');
  }

  private async readSettingsUnsafe(): Promise<ChaptaleSettings> {
    const settings = mergeSettings(await readJsonFile<Partial<ChaptaleSettings>>(this.settingsPath));
    return {
      ...settings,
      webAccess: mergeWebAccessSettings({
        ...settings.webAccess,
        ...(await this.readWebAccessConfig())
      })
    };
  }

  private async readWebAccessConfig(): Promise<UpdatePiWebAccessSettingsPayload> {
    try {
      const config = (await readJsonFile<Record<string, unknown>>(this.piWebAccessConfigPath)) ?? {};
      return fromPiWebAccessConfig(config);
    } catch (error) {
      if (isMissingFileError(error)) {
        return {};
      }

      throw error;
    }
  }

  private async ensureWebAccessConfigFile(settings: PiWebAccessSettings) {
    try {
      await fs.access(this.piWebAccessConfigPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      await this.writeWebAccessConfig(settings);
    }
  }

  private async writeWebAccessConfig(settings: PiWebAccessSettings) {
    const config = toPiWebAccessConfig(settings);
    await writeJsonFile(this.piWebAccessConfigPath, config);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.settingsQueue.then(task, task);
    this.settingsQueue = run.catch(() => undefined);
    return run;
  }
}

function fromPiWebAccessConfig(config: Record<string, unknown>): UpdatePiWebAccessSettingsPayload {
  const webSearch = isRecord(config.webSearch) ? config.webSearch : {};
  const githubClone = isRecord(config.githubClone) ? config.githubClone : {};
  const youtube = isRecord(config.youtube) ? config.youtube : {};
  const video = isRecord(config.video) ? config.video : {};
  const ssrf = isRecord(config.ssrf) ? config.ssrf : {};

  return {
    webSearchEnabled: typeof webSearch.enabled === 'boolean' ? webSearch.enabled : undefined,
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
    allowBrowserCookies: typeof config.allowBrowserCookies === 'boolean' ? config.allowBrowserCookies : undefined,
    chromeProfile: readString(config.chromeProfile),
    searchModel: readString(config.searchModel),
    summaryModel: readString(config.summaryModel),
    curatorTimeoutSeconds: readFiniteNumber(config.curatorTimeoutSeconds),
    githubClone: {
      enabled: typeof githubClone.enabled === 'boolean' ? githubClone.enabled : undefined,
      maxRepoSizeMB: readFiniteNumber(githubClone.maxRepoSizeMB),
      cloneTimeoutSeconds: readFiniteNumber(githubClone.cloneTimeoutSeconds),
      clonePath: readString(githubClone.clonePath)
    },
    youtube: {
      enabled: typeof youtube.enabled === 'boolean' ? youtube.enabled : undefined,
      preferredModel: readString(youtube.preferredModel)
    },
    video: {
      enabled: typeof video.enabled === 'boolean' ? video.enabled : undefined,
      preferredModel: readString(video.preferredModel),
      maxSizeMB: readFiniteNumber(video.maxSizeMB)
    },
    ssrf: {
      allowRanges: Array.isArray(ssrf.allowRanges)
        ? ssrf.allowRanges.filter((item): item is string => typeof item === 'string')
        : undefined
    }
  };
}

function toPiWebAccessConfig(settings: PiWebAccessSettings): Record<string, unknown> {
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

function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
