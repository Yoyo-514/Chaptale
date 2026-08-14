import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unique } from 'radash';

import type { ChaptaleSessionScope, ChaptaleStorageMode } from '@chaptale/ipc-contract';

export type SessionStorageContext = {
  storageMode?: ChaptaleStorageMode;
  workspacePath?: string;
};

export type SessionStorageOptions = {
  rootDir: string;
  cwd: string | (() => string | Promise<string>);
  sessionDir: string | (() => string | Promise<string>);
  sessionsRootDir?: string | (() => string | Promise<string>);
  getStorageContext?: () => SessionStorageContext | Promise<SessionStorageContext>;
};

/**
 * 会话存储的路径解析与文件系统操作：目录定位、枚举与带安全校验的删除。
 * 自 integrations/pi/sessions/storage.ts 平移，语义不变。
 */
export class SessionStorageResolver {
  constructor(private readonly options: SessionStorageOptions) {}

  get rootDir() {
    return this.options.rootDir;
  }

  async getStorageContext(): Promise<SessionStorageContext> {
    return (await this.options.getStorageContext?.()) ?? {};
  }

  async resolveSessionDir() {
    return typeof this.options.sessionDir === 'function' ? await this.options.sessionDir() : this.options.sessionDir;
  }

  async resolveCwd() {
    return typeof this.options.cwd === 'function' ? await this.options.cwd() : this.options.cwd;
  }

  async resolveSessionsRootDir() {
    if (this.options.sessionsRootDir) {
      return typeof this.options.sessionsRootDir === 'function'
        ? await this.options.sessionsRootDir()
        : this.options.sessionsRootDir;
    }

    return path.dirname(await this.resolveSessionDir());
  }

  async ensureSessionDir() {
    const sessionDir = await this.resolveSessionDir();
    await fs.mkdir(sessionDir, { recursive: true });
    return sessionDir;
  }

  /** 当前生效目录 + sessions 根目录下的全部子目录（跨 global/workspace 列表用）。 */
  async getKnownSessionDirs() {
    const [currentSessionDir, sessionsRootDir] = await Promise.all([
      this.ensureSessionDir(),
      this.resolveSessionsRootDir()
    ]);
    await fs.mkdir(sessionsRootDir, { recursive: true });

    const entries = await fs.readdir(sessionsRootDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => path.join(sessionsRootDir, entry.name));

    return unique([currentSessionDir, ...dirs]);
  }

  /** 删除会话文件；拒绝 sessions 根目录之外的路径，防止误删外部文件。 */
  async deleteSessionFile(sessionPath: string) {
    const sessionsRootDir = await this.resolveSessionsRootDir();
    const resolvedSessionPath = path.resolve(sessionPath);
    const resolvedSessionsRootDir = path.resolve(sessionsRootDir);

    if (!resolvedSessionPath.startsWith(`${resolvedSessionsRootDir}${path.sep}`)) {
      throw new Error(`Refuse to delete session outside sessions root directory: ${sessionPath}`);
    }

    await fs.unlink(resolvedSessionPath);
  }
}

export function getSessionScope(sessionDir: string): ChaptaleSessionScope {
  return path.basename(sessionDir) === 'global' ? 'global' : 'workspace';
}
