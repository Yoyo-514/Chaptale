import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AppRelease } from '../../../bridge/help';
import { DEFAULT_SCHEDULED_BACKUP, type ScheduledBackupSettings } from '../../../bridge/scheduled-backup';
import type { ChaptaleSettings, ChaptaleSettingsState, UpdateChaptaleSettingsPayload } from '../../../bridge/settings';
import { readJsonFile, writeJsonFile } from '../../infra/filesystem/files';
import { mergeSettings } from './defaults';

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
    // 开发环境用独立目录，`pnpm dev` 不读写安装版的作品与配置。
    const defaultDir = process.env.NODE_ENV === 'development' ? '.chaptale-dev' : '.chaptale';
    this.rootDir = options.rootDir ?? path.join(os.homedir(), defaultDir);
    this.settingsPath = path.join(this.rootDir, 'settings.json');
  }

  async getState(): Promise<ChaptaleSettingsState> {
    const settings = await this.readSettings();
    await this.ensureSettingsFile(settings);

    return {
      settings,
      paths: { rootDir: this.rootDir, settingsPath: this.settingsPath }
    };
  }

  async update(payload: UpdateChaptaleSettingsPayload): Promise<ChaptaleSettingsState> {
    await this.enqueue(async () => {
      const current = await this.readSettingsUnsafe();
      const next: ChaptaleSettings = {
        ...current,
        editor: { autoSave: payload.editor?.autoSave ?? current.editor?.autoSave ?? false },
        theme: payload.theme ?? current.theme,
        checkUpdatesOnStartup: payload.checkUpdatesOnStartup ?? current.checkUpdatesOnStartup
      };

      await writeJsonFile(this.settingsPath, next);
    });

    return this.getState();
  }

  async readScheduledBackup(): Promise<ScheduledBackupSettings> {
    return (await this.readSettings()).scheduledBackup ?? { ...DEFAULT_SCHEDULED_BACKUP };
  }

  async setScheduledBackup(scheduledBackup: ScheduledBackupSettings): Promise<void> {
    await this.enqueue(async () => {
      await fs.mkdir(this.rootDir, { recursive: true });
      await writeJsonFile(this.settingsPath, { ...(await this.readSettingsUnsafe()), scheduledBackup });
    });
  }

  async setKnownAppUpdate(knownAppUpdate: AppRelease | undefined): Promise<void> {
    await this.enqueue(async () => {
      await writeJsonFile(this.settingsPath, { ...(await this.readSettingsUnsafe()), knownAppUpdate });
    });
  }

  /** 数据目录只经数据目录流程写入，不随普通设置更新。 */
  async setDataDir(dataDir: string): Promise<void> {
    await this.enqueue(async () => {
      await fs.mkdir(this.rootDir, { recursive: true });
      await writeJsonFile(this.settingsPath, { ...(await this.readSettingsUnsafe()), dataDir });
    });
  }

  /** 这份安装的标识；第一次用到时生成并写入设置文件。 */
  installId(): Promise<string> {
    return this.enqueue(async () => {
      const current = await this.readSettingsUnsafe();
      if (current.installId) return current.installId;
      const installId = randomUUID();
      await fs.mkdir(this.rootDir, { recursive: true });
      await writeJsonFile(this.settingsPath, { ...current, installId });
      return installId;
    });
  }

  async readSettings(): Promise<ChaptaleSettings> {
    return this.enqueue(() => this.readSettingsUnsafe());
  }

  /** 只补齐缺失的配置文件；已有文件即使内容不完整也交给 merge 逻辑补齐，避免覆盖用户设置。 */
  async ensureSettingsFile(settings?: ChaptaleSettings) {
    // 缺失检查与回填也必须串行，否则旧的初始化快照会覆盖刚完成的设置更新。
    await this.enqueue(async () => {
      await fs.mkdir(this.rootDir, { recursive: true });

      if (!(await readJsonFile<Partial<ChaptaleSettings>>(this.settingsPath))) {
        await writeJsonFile(this.settingsPath, settings ?? mergeSettings(undefined));
      }
    });
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
