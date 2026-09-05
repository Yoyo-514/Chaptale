import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  CreateEntryArgs,
  CreateEntryResult,
  DirectoryEntry,
  ListDirectoryArgs,
  ListDirectoryResult,
  WorkspaceState
} from '@chaptale/ipc-contract';

import type { SettingsService } from '../../core/settings/service';
import { DEFAULT_IGNORED_DIRS, resolveWithinCwd } from '../../infra/filesystem/path-guard';

/** Windows 保留字符；跨平台统一按最严的一套挡，避免作品目录在另一台机器上打不开。 */
const INVALID_NAME_CHARS = /[<>:"/\\|?*]/;
/** 控制字符上限；用码位比较而不写进正则，字面控制字符在源码里是隐形的。 */
const FIRST_PRINTABLE_CODE_POINT = 0x20;
/** Windows 设备名；同名文件在资源管理器里无法访问。 */
const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)
]);

/** 工作区状态、目录单层枚举与条目新建；根路径只认设置服务，正文不在此读取。 */
export class WorkspaceService {
  constructor(private readonly settings: Pick<SettingsService, 'getStorageContext'>) {}

  async getState(): Promise<WorkspaceState> {
    const context = await this.settings.getStorageContext();
    const rootPath = context.storageMode === 'workspace' && context.workspacePath ? context.workspacePath : null;
    const hasChaptaleMetadata = rootPath
      ? await fs.stat(path.join(rootPath, '.chaptale')).then(
          stat => stat.isDirectory(),
          () => false
        )
      : false;
    return { rootPath, displayName: rootPath ? path.basename(rootPath) : null, hasChaptaleMetadata };
  }

  async listDirectory(args: ListDirectoryArgs): Promise<ListDirectoryResult> {
    const { rootPath } = await this.getState();
    if (!rootPath) return { ok: false, code: 'no-workspace', message: '请先打开工作区' };
    if (args.relativePath && !isSafeRelativePath(args.relativePath)) {
      return { ok: false, code: 'outside-workspace', message: '只能读取工作区内的相对路径' };
    }
    try {
      const directory = await resolveWithinCwd(rootPath, args.relativePath);
      const children = await fs.readdir(directory, { withFileTypes: true });
      const entries: DirectoryEntry[] = [];
      for (const child of children) {
        if (DEFAULT_IGNORED_DIRS.has(child.name) || (!args.includeInternal && child.name === '.chaptale')) continue;
        // 不跟随链接：避免越界目录及递归展开形成环，工作区根本身仍可为链接。
        if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) continue;
        entries.push({
          name: child.name,
          relativePath: joinRelative(args.relativePath, child.name),
          kind: child.isDirectory() ? 'directory' : 'file'
        });
      }
      entries.sort(compareEntries);
      return { ok: true, entries };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as NodeJS.ErrnoException).code;
      return {
        ok: false,
        code: message.includes('工作区之外')
          ? 'outside-workspace'
          : code === 'ENOENT'
            ? 'not-found'
            : code === 'ENOTDIR'
              ? 'not-a-directory'
              : 'read-failed',
        message
      };
    }
  }

  /**
   * 在工作区内新建空文件或目录。
   *
   * 只做「不存在则创建」：已存在一律报错而不是覆盖——这里的目标是作者的正文，
   * 静默截断一个同名章节比让用户改个名字糟糕得多。
   */
  async createEntry(args: CreateEntryArgs): Promise<CreateEntryResult> {
    const { rootPath } = await this.getState();
    if (!rootPath) return { ok: false, code: 'no-workspace', message: '请先打开工作区' };
    if (!isSafeRelativePath(args.relativePath)) {
      return { ok: false, code: 'outside-workspace', message: '只能在工作区内新建' };
    }

    const name = args.relativePath.split('/').at(-1) ?? '';
    const nameError = validateEntryName(name);
    if (nameError) return { ok: false, code: 'invalid-name', message: nameError };

    try {
      const target = await resolveWithinCwd(rootPath, args.relativePath);

      if (args.kind === 'directory') {
        // recursive: false 让「已存在」直接抛 EEXIST，而不是静默通过。
        await fs.mkdir(target);
      } else {
        // wx：目标已存在就失败，不截断已有内容。
        await (await fs.open(target, 'wx')).close();
      }

      return { ok: true, entry: { name, relativePath: args.relativePath, kind: args.kind } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as NodeJS.ErrnoException).code;

      if (message.includes('工作区之外')) return { ok: false, code: 'outside-workspace', message };
      if (code === 'EEXIST') return { ok: false, code: 'already-exists', message: `${name} 已存在` };

      return { ok: false, code: 'write-failed', message };
    }
  }
}

/** 目录优先，同类按中文习惯的数字感知排序；主进程保证顺序，Renderer 不再各自实现一遍。 */
function compareEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  return (
    Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
    a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  );
}

function joinRelative(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** schema 已挡住主要形态，这里是主进程侧的独立复核：不接受绝对路径、盘符、反斜杠与 `.`/`..` 段。 */
function isSafeRelativePath(relativePath: string): boolean {
  if (path.isAbsolute(relativePath) || /[\\:\0]/.test(relativePath)) return false;
  return relativePath.split('/').every(part => part && part !== '.' && part !== '..');
}

/** 返回错误说明，合法时返回 undefined。 */
function validateEntryName(name: string): string | undefined {
  if (!name) return '名称不能为空';
  if (INVALID_NAME_CHARS.test(name)) return '名称不能包含 < > : " / \\ | ? *';
  if ([...name].some(char => (char.codePointAt(0) ?? 0) < FIRST_PRINTABLE_CODE_POINT)) {
    return '名称不能包含控制字符';
  }
  // Windows 会静默吃掉结尾的点和空格，落盘名与用户输入不一致。
  if (name !== name.trim() || name.endsWith('.')) return '名称不能以空格或点结尾';
  if (RESERVED_NAMES.has(name.split('.')[0]?.toUpperCase() ?? '')) return `${name} 是系统保留名称`;
  return undefined;
}
