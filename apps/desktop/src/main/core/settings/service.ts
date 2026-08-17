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

/** WebTools API Key 下发给 Renderer 时的占位掩码；提交时被忽略（保留原值），空串表示显式清除。 */
const KEY_MASK = '••••••••';

/** 真实 key 只在主进程配置文件中停留，下发状态一律掩码化。 */
function maskWebToolsKeys(keys: WebToolsSettings['keys']): WebToolsSettings['keys'] {
  const masked: WebToolsSettings['keys'] = {};

  for (const [name, value] of Object.entries(keys)) {
    if (value) {
      masked[name as keyof WebToolsSettings['keys']] = KEY_MASK;
    }
  }

  return masked;
}

/** 提交前清洗 keys：掩码占位忽略（保留原值）；空串保留（显式清除）；其余为真实更新。 */
function sanitizeWebToolsKeysPayload(payload: UpdateWebToolsSettingsPayload): UpdateWebToolsSettingsPayload {
  if (!payload.keys) {
    return payload;
  }

  const keys: WebToolsSettings['keys'] = {};

  for (const [name, value] of Object.entries(payload.keys)) {
    if (value === KEY_MASK) {
      continue;
    }

    keys[name as keyof WebToolsSettings['keys']] = value;
  }

  return Object.keys(keys).length > 0 ? { ...payload, keys } : { ...payload, keys: undefined };
}

/** 存储域槽位 key：global 单槽；workspace 按 resolve 后的路径各占一槽。 */
function storageDomainKey(storage: ChaptaleStorageSettings): string {
  if (storage.mode === 'workspace' && storage.workspacePath) {
    return `workspace:${path.resolve(storage.workspacePath)}`;
  }

  return 'global';
}

export type SettingsServiceOptions = {
  rootDir?: string;
};

/** 集中定义应用配置路径，并负责应用设置、Web Access 配置及会话目录选择的持久化。 */
export class SettingsService {
  readonly rootDir: string;
  readonly agentDir: string;
  /** 内置 skills 的物化目标；可重建缓存，每次启动全量重写。 */
  readonly builtinSkillsDir: string;
  readonly settingsPath: string;
  readonly modelsPath: string;
  readonly webToolsConfigPath: string;
  readonly sessionsRootDir: string;
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
    this.modelsPath = path.join(this.agentDir, 'models.json');
    this.webToolsConfigPath = path.join(this.agentDir, 'web-tools.json');
    this.sessionsRootDir = path.join(this.agentDir, 'sessions');
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
      const next: ChaptaleSettings = {
        version: current.version,
        storage: {
          ...current.storage,
          ...payload.storage
        },
        ...(current.lastSessions && Object.keys(current.lastSessions).length > 0
          ? { lastSessions: { ...current.lastSessions } }
          : {})
      };

      // workspace 模式必须绑定有效路径；不完整的设置回退到 global，避免生成不可定位的会话目录。
      if (next.storage.mode === 'workspace' && !next.storage.workspacePath) {
        next.storage.mode = 'global';
      }

      // 切回 global 时清掉工作区路径：避免设置面板残留显示，保持落盘数据与模式一致。
      if (next.storage.mode === 'global') {
        delete next.storage.workspacePath;
      }

      // lastSessionId：null=清除当前域槽位；string=写当前域槽位；undefined=保持不动。
      if (payload.lastSessionId !== undefined) {
        const slots = { ...next.lastSessions };
        const domainKey = storageDomainKey(next.storage);

        if (payload.lastSessionId === null) {
          delete slots[domainKey];
        } else if (payload.lastSessionId) {
          slots[domainKey] = payload.lastSessionId;
        }

        next.lastSessions = Object.keys(slots).length > 0 ? slots : undefined;
      }

      await writeJsonFile(this.settingsPath, next);
    });

    return this.getState();
  }

  async updateWebTools(payload: UpdateWebToolsSettingsPayload): Promise<ChaptaleSettingsState> {
    await this.enqueue(async () => {
      const current = await this.readWebToolsSettingsUnsafe();
      await this.writeWebToolsConfig(this.webToolsAdapter.mergeUpdate(current, sanitizeWebToolsKeysPayload(payload)));
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
      settings: {
        ...settings,
        // 合成视图：按当前 storage 域取槽位；不落盘（落盘只写 lastSessions）。
        lastSessionId: settings.lastSessions?.[storageDomainKey(settings.storage)]
      },
      webTools: { ...webTools, keys: maskWebToolsKeys(webTools.keys) },
      paths: {
        rootDir: this.rootDir,
        agentDir: this.agentDir,
        settingsPath: this.settingsPath,
        modelsPath: this.modelsPath,
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
