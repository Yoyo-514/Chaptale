import type {
  ChaptaleSettings,
  ChaptaleSettingsState,
  ChaptaleStorageSettings,
  UpdateChaptaleSettingsPayload
} from '@chaptale/ipc-contract';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SETTINGS_VERSION = 1;
const DEFAULT_SETTINGS: ChaptaleSettings = {
  version: SETTINGS_VERSION,
  storage: {
    mode: 'global'
  },
  llm: {}
};

export type SettingsServiceOptions = {
  rootDir?: string;
};

function cloneDefaultSettings(): ChaptaleSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as ChaptaleSettings;
}

function sanitizeWorkspaceLabel(workspacePath: string) {
  const baseName = path.basename(workspacePath) || 'workspace';
  // oxlint-disable-next-line no-control-regex
  return baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0, 48) || 'workspace';
}

function toWorkspaceSessionDirName(workspacePath: string) {
  const normalized = path.resolve(workspacePath).toLowerCase();
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `${sanitizeWorkspaceLabel(workspacePath)}-${hash}`;
}

function mergeSettings(value: Partial<ChaptaleSettings> | undefined): ChaptaleSettings {
  return {
    ...cloneDefaultSettings(),
    ...value,
    version: SETTINGS_VERSION,
    storage: {
      ...DEFAULT_SETTINGS.storage,
      ...value?.storage
    },
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...value?.llm
    }
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');

    // 容忍空文件 / 损坏文件：设置文件可从默认值再生，不应让单次读取失败拖死所有 IPC handler。
    if (!raw.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // 先写临时文件再 rename，保证读方永远看到完整 JSON，避免并发 IPC 下读到截断中的文件。
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

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

  private async readSettingsUnsafe(): Promise<ChaptaleSettings> {
    return mergeSettings(await readJsonFile<Partial<ChaptaleSettings>>(this.settingsPath));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.settingsQueue.then(task, task);
    this.settingsQueue = run.catch(() => undefined);
    return run;
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
}
