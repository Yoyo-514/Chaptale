import type {
  ChaptaleSettings,
  ChaptaleSettingsState,
  ChaptaleStorageSettings,
  UpdateChaptaleSettingsPayload
} from '@chaptale/ipc-contract';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readJsonFile, writeJsonFile } from '../settings/json-file';
import { cloneDefaultSettings, mergeSettings } from '../settings/settings-defaults';
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
        }
      };

      if (next.storage.mode === 'workspace' && !next.storage.workspacePath) {
        next.storage.mode = 'global';
      }

      await writeJsonFile(this.settingsPath, next);
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

    await this.ensureSettingsFile();
  }

  async readSettings(): Promise<ChaptaleSettings> {
    return this.enqueue(() => this.readSettingsUnsafe());
  }

  async ensureSettingsFile() {
    // 只在文件缺失时创建默认设置；读路径绝不重写文件，
    // 避免启动时多个 IPC handler 并发触发 “读到半截断文件” 的竞态。
    try {
      await fs.access(this.settingsPath);
    } catch {
      await writeJsonFile(this.settingsPath, cloneDefaultSettings());
    }
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
    return mergeSettings(await readJsonFile<Partial<ChaptaleSettings>>(this.settingsPath));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.settingsQueue.then(task, task);
    this.settingsQueue = run.catch(() => undefined);
    return run;
  }
}
