import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  ChaptaleSettings,
  ChaptaleSettingsState,
  ChaptaleWorkspaceSettings,
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

/**
 * 最近会话槽位 key：作品绝对路径。没打开作品就没有槽位可言。
 *
 * 键用 resolve 后的路径而不是作品目录名，是为了让手改过 settings.json 的人看得懂自己删的是哪一行。
 */
function workspaceSlotKey(workspace: ChaptaleWorkspaceSettings): string | undefined {
  return workspace.path ? path.resolve(workspace.path) : undefined;
}

/** 合成当前作品的最近会话：取当前作品槽位，没打开作品时无值。 */
function currentLastSessionId(settings: ChaptaleSettings): string | undefined {
  const slotKey = workspaceSlotKey(settings.workspace);

  return slotKey ? settings.lastSessions?.[slotKey] : undefined;
}

/**
 * 合并作品目录更新：undefined 保持不动，null 或空串关闭当前作品。
 *
 * 「关闭」落盘时不留 `path: undefined` 这类空字段：settings.json 是手改得动的文件，
 * 留一个空壳字段会让人以为还有作品。
 */
function mergeWorkspace(
  current: ChaptaleWorkspaceSettings,
  payload: UpdateChaptaleSettingsPayload['workspace']
): ChaptaleWorkspaceSettings {
  if (!payload || payload.path === undefined) {
    return { ...current };
  }

  const nextPath = payload.path?.trim();

  return nextPath ? { path: nextPath } : {};
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
        workspace: mergeWorkspace(current.workspace, payload.workspace),
        explorer: {
          ...current.explorer,
          ...payload.explorer
        },
        editor: { autoSave: payload.editor?.autoSave ?? current.editor?.autoSave ?? false },
        backup: {
          ...current.backup,
          ...payload.backup
        },
        onboarding: {
          completedVersion: payload.onboarding?.completedVersion ?? current.onboarding?.completedVersion ?? 0
        },
        theme: payload.theme ?? current.theme,
        ...(current.lastSessions && Object.keys(current.lastSessions).length > 0
          ? { lastSessions: { ...current.lastSessions } }
          : {}),
        ...(current.recentWorkspaces ? { recentWorkspaces: [...current.recentWorkspaces] } : {})
      };

      if (next.workspace.path) {
        next.recentWorkspaces = [
          next.workspace.path,
          ...(next.recentWorkspaces ?? []).filter(item => item !== next.workspace.path)
        ].slice(0, 8);
      }

      // lastSessionId：null=清除当前作品槽位；string=写当前作品槽位；undefined=保持不动。
      // 没有作品时整块不动：写出去只会是个无主槽位，谁也取不回来。
      const slotKey = workspaceSlotKey(next.workspace);

      if (payload.lastSessionId !== undefined && slotKey) {
        const slots = { ...next.lastSessions };

        if (payload.lastSessionId === null) {
          delete slots[slotKey];
        } else if (payload.lastSessionId) {
          slots[slotKey] = payload.lastSessionId;
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
    const sessionDir = this.getSessionDir(resolvedSettings.workspace);

    await Promise.all([
      fs.mkdir(this.rootDir, { recursive: true }),
      fs.mkdir(this.agentDir, { recursive: true }),
      fs.mkdir(this.sessionsRootDir, { recursive: true }),
      // 没有作品就没有会话目录；空串交给 mkdir 会落到进程 cwd。
      ...(sessionDir ? [fs.mkdir(sessionDir, { recursive: true })] : [])
    ]);

    await this.ensureSettingsFile(resolvedSettings);
  }

  async readSettings(): Promise<ChaptaleSettings> {
    return this.enqueue(() => this.readSettingsUnsafe());
  }

  /** 只补齐缺失的配置文件；已有文件即使内容不完整也交给 merge 逻辑兼容，避免覆盖用户设置。 */
  async ensureSettingsFile(settings?: ChaptaleSettings) {
    // 缺失检查与回填也必须串行，否则旧的初始化快照会覆盖刚完成的作品更新。
    await this.enqueue(async () => {
      const rawSettings = await this.readRawSettingsFile();

      if (!rawSettings) {
        await writeJsonFile(this.settingsPath, settings ?? mergeSettings(undefined));
      }

      await this.ensureWebToolsConfigFile(DEFAULT_WEB_TOOLS_SETTINGS);
    });
  }

  async getCurrentSessionDir() {
    const settings = await this.readSettings();
    await this.ensureBaseDirs(settings);
    return this.getSessionDir(settings.workspace);
  }

  /** 会话归属的作品目录；没打开作品时为空串（Renderer 据此判定"不能聊"）。 */
  async getCurrentCwd() {
    const settings = await this.readSettings();
    return this.getCurrentCwdFromWorkspace(settings.workspace);
  }

  async getStorageContext() {
    const settings = await this.readSettings();
    return { workspacePath: settings.workspace.path };
  }

  /**
   * 应用级数据的落脚目录（运行记录、审查产物、权限规则、记忆待办）。
   *
   * 这些数据归属作品，但读取入口不依赖作品是否打开——没有作品时退回配置目录，
   * 免得空 cwd 经 path.join 变成相对路径落到进程 cwd。
   */
  async getAppStateCwd() {
    return (await this.getCurrentCwd()) || this.agentDir;
  }

  /**
   * 将作品目录映射为稳定的会话目录。
   * 作品路径先转换为安全目录名，避免把绝对路径层级直接拼入应用数据目录。
   */
  getSessionDir(workspace: ChaptaleWorkspaceSettings) {
    return workspace.path ? path.join(this.sessionsRootDir, toWorkspaceSessionDirName(workspace.path)) : '';
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
        // 合成视图：按当前作品取槽位；不落盘（落盘只写 lastSessions）。
        lastSessionId: currentLastSessionId(settings)
      },
      webTools: { ...webTools, keys: maskWebToolsKeys(webTools.keys) },
      paths: {
        rootDir: this.rootDir,
        agentDir: this.agentDir,
        settingsPath: this.settingsPath,
        modelsPath: this.modelsPath,
        webToolsConfigPath: this.webToolsConfigPath,
        sessionsRootDir: this.sessionsRootDir,
        effectiveSessionDir: this.getSessionDir(settings.workspace),
        currentCwd: this.getCurrentCwdFromWorkspace(settings.workspace)
      }
    };
  }

  /** currentCwd 是 Renderer 绑定会话的权威来源；作品路径只在 Main 侧解析，避免前端自行猜测。 */
  private getCurrentCwdFromWorkspace(workspace: ChaptaleWorkspaceSettings) {
    return workspace.path ?? '';
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
