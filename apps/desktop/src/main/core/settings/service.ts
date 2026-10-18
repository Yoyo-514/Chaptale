import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  ChaptaleSettings,
  ChaptaleSettingsState,
  ChaptaleWorkspaceSettings,
  UpdateChaptaleSettingsPayload
} from '@chaptale/ipc-contract';

import { readJsonFile, writeJsonFile } from '../../infra/filesystem/files';
import { mergeSettings } from './defaults';

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

/** 集中定义应用配置路径，并负责应用设置的持久化。 */
export class SettingsService {
  readonly rootDir: string;
  readonly settingsPath: string;

  // 串行化设置文件的读写，避免多个 IPC handler 并发读写造成竞态。
  private settingsQueue: Promise<unknown> = Promise.resolve();

  constructor(options: SettingsServiceOptions = {}) {
    this.rootDir = options.rootDir ?? path.join(os.homedir(), '.chaptale');
    this.settingsPath = path.join(this.rootDir, 'settings.json');
  }

  async getState(): Promise<ChaptaleSettingsState> {
    const settings = await this.readSettings();
    await this.ensureSettingsFile(settings);

    return {
      settings,
      paths: { rootDir: this.rootDir, settingsPath: this.settingsPath, currentCwd: settings.workspace.path ?? '' }
    };
  }

  async update(payload: UpdateChaptaleSettingsPayload): Promise<ChaptaleSettingsState> {
    await this.enqueue(async () => {
      const current = await this.readSettingsUnsafe();
      const next: ChaptaleSettings = {
        version: current.version,
        workspace: mergeWorkspace(current.workspace, payload.workspace),
        explorer: { ...current.explorer, ...payload.explorer },
        editor: { autoSave: payload.editor?.autoSave ?? current.editor?.autoSave ?? false },
        backup: { ...current.backup, ...payload.backup },
        theme: payload.theme ?? current.theme,
        ...(current.recentWorkspaces ? { recentWorkspaces: [...current.recentWorkspaces] } : {})
      };

      if (next.workspace.path) {
        next.recentWorkspaces = [
          next.workspace.path,
          ...(next.recentWorkspaces ?? []).filter(item => item !== next.workspace.path)
        ].slice(0, 8);
      }

      await writeJsonFile(this.settingsPath, next);
    });

    return this.getState();
  }

  async readSettings(): Promise<ChaptaleSettings> {
    return this.enqueue(() => this.readSettingsUnsafe());
  }

  /** 只补齐缺失的配置文件；已有文件即使内容不完整也交给 merge 逻辑兼容，避免覆盖用户设置。 */
  async ensureSettingsFile(settings?: ChaptaleSettings) {
    // 缺失检查与回填也必须串行，否则旧的初始化快照会覆盖刚完成的作品更新。
    await this.enqueue(async () => {
      await fs.mkdir(this.rootDir, { recursive: true });

      if (!(await readJsonFile<Partial<ChaptaleSettings>>(this.settingsPath))) {
        await writeJsonFile(this.settingsPath, settings ?? mergeSettings(undefined));
      }
    });
  }

  async getStorageContext() {
    return { workspacePath: (await this.readSettings()).workspace.path };
  }

  private async readSettingsUnsafe(): Promise<ChaptaleSettings> {
    return mergeSettings(await readJsonFile<Partial<ChaptaleSettings>>(this.settingsPath));
  }

  /** 串行化设置读写；单次失败只影响调用方，不得阻塞队列中的后续操作。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.settingsQueue.then(task, task);
    this.settingsQueue = run.catch(() => undefined);
    return run;
  }
}
