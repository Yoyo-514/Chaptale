import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unique } from 'radash';

export type SessionStorageContext = {
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

  /**
   * 建会话前必须有一个落脚的作品：没有作品时没有会话目录，空串会让 mkdir 落到进程 cwd。
   */
  async ensureSessionDir() {
    const sessionDir = await this.resolveSessionDir();

    if (!sessionDir) {
      throw new Error('请先打开作品');
    }

    await fs.mkdir(sessionDir, { recursive: true });
    return sessionDir;
  }

  /**
   * sessions 根目录 + 其下全部子目录；当前作品的目录排在首位。
   *
   * 历史要能一次看全所有作品的会话（删起来不用逐个作品打开目录），因此这里不按当前作品收窄。
   * 没有打开作品时只剩既存目录：此时读得到、删得掉，但没有新会话的落脚点。
   */
  async getKnownSessionDirs() {
    const [currentSessionDir, sessionsRootDir] = await Promise.all([
      this.resolveSessionDir(),
      this.resolveSessionsRootDir()
    ]);
    await fs.mkdir(sessionsRootDir, { recursive: true });

    const entries = await fs.readdir(sessionsRootDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => path.join(sessionsRootDir, entry.name));

    if (!currentSessionDir) {
      return unique(dirs);
    }

    await fs.mkdir(currentSessionDir, { recursive: true });
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
