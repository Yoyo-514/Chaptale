import type {
  ChaptaleSettings,
  ChaptaleSettingsState,
  ChaptaleStorageSettings,
  PiWebAccessSettings,
  UpdateChaptaleSettingsPayload,
  UpdatePiWebAccessSettingsPayload
} from '@chaptale/ipc-contract';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readJsonFile, writeJsonFile } from '../settings/json-file';
import {
  fromPiWebAccessConfig,
  mergeWebAccessUpdate,
  toPiWebAccessConfig
} from '../settings/pi-web-access-config.mapper';
import { DEFAULT_WEB_ACCESS_SETTINGS, mergeSettings, mergeWebAccessSettings } from '../settings/settings-defaults';
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

    return this.createState(settings, await this.readWebAccessSettings());
  }

  async update(payload: UpdateChaptaleSettingsPayload): Promise<ChaptaleSettingsState> {
    await this.enqueue(async () => {
      const current = await this.readSettingsUnsafe();
      const next: ChaptaleSettings = {
        version: current.version,
        storage: {
          ...current.storage,
          ...payload.storage
        }
      };

      if (next.storage.mode === 'workspace' && !next.storage.workspacePath) {
        next.storage.mode = 'global';
      }

      await writeJsonFile(this.settingsPath, next);
    });

    return this.getState();
  }

  async updateWebAccess(payload: UpdatePiWebAccessSettingsPayload): Promise<ChaptaleSettingsState> {
    await this.enqueue(async () => {
      const current = await this.readWebAccessSettingsUnsafe();
      await this.writeWebAccessConfig(mergeWebAccessUpdate(current, payload));
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
    const rawSettings = await this.readRawSettingsFile();

    if (!rawSettings) {
      await writeJsonFile(this.settingsPath, settings ?? mergeSettings(undefined));
    }

    await this.ensureWebAccessConfigFile(DEFAULT_WEB_ACCESS_SETTINGS);
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
    return mergeSettings(await this.readRawSettingsFile());
  }

  private async readRawSettingsFile(): Promise<Partial<ChaptaleSettings> | undefined> {
    return readJsonFile<Partial<ChaptaleSettings>>(this.settingsPath);
  }

  private async readWebAccessSettings(): Promise<PiWebAccessSettings> {
    return this.enqueue(() => this.readWebAccessSettingsUnsafe());
  }

  private async readWebAccessSettingsUnsafe(): Promise<PiWebAccessSettings> {
    return mergeWebAccessSettings(await this.readWebAccessConfig());
  }

  private createState(settings: ChaptaleSettings, webAccess: PiWebAccessSettings): ChaptaleSettingsState {
    return {
      settings,
      webAccess,
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

function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
