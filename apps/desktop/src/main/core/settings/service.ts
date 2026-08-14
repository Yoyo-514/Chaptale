import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  ChaptaleSettings,
  ChaptaleSettingsState,
  ChaptaleStorageSettings,
  UpdateChaptaleSettingsPayload,
  UpdateWebToolsSettingsPayload,
  WebToolsSettings
} from '@chaptale/ipc-contract';

import { readJsonFile, writeJsonFile } from '../../infra/filesystem/files';
import { DEFAULT_WEB_TOOLS_SETTINGS, mergeSettings } from './defaults';
import type { WebToolsAdapter } from './web-tools-adapter';
import { toWorkspaceSessionDirName } from './workspace-session-directory';

export type SettingsServiceOptions = {
  rootDir?: string;
};

/** 集中定义应用与 Pi 集成使用的配置路径，并负责应用设置、Web Access 配置及会话目录选择的持久化。 */
export class SettingsService {
  readonly rootDir: string;
  readonly agentDir: string;
  /** 内置 skills 的物化目标；可重建缓存，每次启动全量重写。 */
  readonly builtinSkillsDir: string;
  readonly settingsPath: string;
  readonly piSettingsPath: string;
  readonly piModelsPath: string;
  readonly piAuthPath: string;
  readonly webToolsConfigPath: string;
  readonly sessionsRootDir: string;
  /** task 型子任务 session 目录；不在 sessionsRootDir 扫描范围，天然不进历史 UI。 */
  readonly taskSessionsDir: string;
  /** 会话级 todo 清单存储目录；随会话删除一同清理。 */
  readonly todosDir: string;

  // 串行化设置文件的读写，避免多个 IPC handler 并发读写造成竞态。
  private settingsQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly webToolsAdapter: WebToolsAdapter,
    options: SettingsServiceOptions = {}
  ) {
    this.rootDir = options.rootDir ?? path.join(os.homedir(), '.chaptale');
    this.agentDir = path.join(this.rootDir, 'agent');
    this.builtinSkillsDir = path.join(this.rootDir, 'cache', 'builtin-skills');
    this.settingsPath = path.join(this.rootDir, 'settings.json');
    this.piSettingsPath = path.join(this.agentDir, 'settings.json');
    this.piModelsPath = path.join(this.agentDir, 'models.json');
    this.piAuthPath = path.join(this.agentDir, 'auth.json');
    this.webToolsConfigPath = path.join(this.agentDir, 'web-tools.json');
    this.sessionsRootDir = path.join(this.agentDir, 'sessions');
    this.taskSessionsDir = path.join(this.agentDir, 'task-sessions');
    this.todosDir = path.join(this.agentDir, 'todos');
  }

  async getState(): Promise<ChaptaleSettingsState> {
    const settings = await this.readSettings();
    await this.ensureBaseDirs(settings);

    return this.createState(settings, await this.readWebToolsSettings());
  }

  async update(payload: UpdateChaptaleSettingsPayload): Promise<ChaptaleSettingsState> {
    await this.enqueue(async () => {
      const current = await this.readSettingsUnsafe();
      const lastSessionId =
        payload.lastSessionId === null ? undefined : (payload.lastSessionId ?? current.lastSessionId);
      const next: ChaptaleSettings = {
        version: current.version,
        storage: {
          ...current.storage,
          ...payload.storage
        },
        ...(lastSessionId ? { lastSessionId } : {})
      };

      // workspace 模式必须绑定有效路径；不完整的设置回退到 global，避免生成不可定位的会话目录。
      if (next.storage.mode === 'workspace' && !next.storage.workspacePath) {
        next.storage.mode = 'global';
      }

      await writeJsonFile(this.settingsPath, next);
    });

    return this.getState();
  }

  async updateWebTools(payload: UpdateWebToolsSettingsPayload): Promise<ChaptaleSettingsState> {
    await this.enqueue(async () => {
      const current = await this.readWebToolsSettingsUnsafe();
      await this.writeWebToolsConfig(this.webToolsAdapter.mergeUpdate(current, payload));
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

  /** 只补齐缺失的配置文件；已有文件即使内容不完整也交给 merge 逻辑兼容，避免覆盖用户设置。 */
  async ensureSettingsFile(settings?: ChaptaleSettings) {
    const rawSettings = await this.readRawSettingsFile();

    if (!rawSettings) {
      await writeJsonFile(this.settingsPath, settings ?? mergeSettings(undefined));
    }

    await this.ensureWebToolsConfigFile(DEFAULT_WEB_TOOLS_SETTINGS);
  }

  async getCurrentSessionDir() {
    const settings = await this.readSettings();
    await this.ensureBaseDirs(settings);
    return this.getSessionDir(settings.storage);
  }

  async getCurrentCwd() {
    const settings = await this.readSettings();
    return this.getCurrentCwdFromStorage(settings.storage);
  }

  async getStorageContext() {
    const settings = await this.readSettings();
    return {
      storageMode: settings.storage.mode,
      workspacePath: settings.storage.workspacePath
    };
  }

  /**
   * 将存储设置映射为稳定的会话目录。
   * 工作区路径先转换为安全目录名，避免把绝对路径层级直接拼入应用数据目录。
   */
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

  private async readWebToolsSettings(): Promise<WebToolsSettings> {
    return this.enqueue(() => this.readWebToolsSettingsUnsafe());
  }

  private async readWebToolsSettingsUnsafe(): Promise<WebToolsSettings> {
    const payload = await this.readWebToolsConfig();
    return this.webToolsAdapter.mergeUpdate(DEFAULT_WEB_TOOLS_SETTINGS, payload);
  }

  private createState(settings: ChaptaleSettings, webTools: WebToolsSettings): ChaptaleSettingsState {
    return {
      settings,
      webTools,
      paths: {
        rootDir: this.rootDir,
        agentDir: this.agentDir,
        settingsPath: this.settingsPath,
        piSettingsPath: this.piSettingsPath,
        piModelsPath: this.piModelsPath,
        piAuthPath: this.piAuthPath,
        webToolsConfigPath: this.webToolsConfigPath,
        sessionsRootDir: this.sessionsRootDir,
        effectiveSessionDir: this.getSessionDir(settings.storage),
        currentCwd: this.getCurrentCwdFromStorage(settings.storage)
      }
    };
  }

  /** currentCwd 是 Renderer 绑定会话的权威来源；workspace 路径只在 Main 侧解析，避免前端自行猜测。 */
  private getCurrentCwdFromStorage(storage: ChaptaleStorageSettings) {
    if (storage.mode === 'workspace' && storage.workspacePath) {
      return storage.workspacePath;
    }

    return path.join(this.agentDir, 'global');
  }

  private async readWebToolsConfig(): Promise<UpdateWebToolsSettingsPayload> {
    try {
      const config = (await readJsonFile<Record<string, unknown>>(this.webToolsConfigPath)) ?? {};
      return this.webToolsAdapter.fromConfig(config);
    } catch (error) {
      if (isMissingFileError(error)) {
        return {};
      }

      throw error;
    }
  }

  private async ensureWebToolsConfigFile(settings: WebToolsSettings) {
    try {
      await fs.access(this.webToolsConfigPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      await this.writeWebToolsConfig(settings);
    }
  }

  private async writeWebToolsConfig(settings: WebToolsSettings) {
    const config = this.webToolsAdapter.toConfig(settings);
    await writeJsonFile(this.webToolsConfigPath, config);
  }

  /** 串行化设置读写；单次失败只影响调用方，不得阻塞队列中的后续操作。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.settingsQueue.then(task, task);
    this.settingsQueue = run.catch(() => undefined);
    return run;
  }
}

function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
