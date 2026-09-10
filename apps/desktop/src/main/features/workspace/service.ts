import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';

import {
  MAX_DOCUMENT_BYTES,
  type WriteDocumentArgs,
  type WriteDocumentResult,
  type WorkspaceLayoutResult,
  type CreateChapterArgs,
  type CreateEntryArgs,
  type CreateEntryResult,
  type DirectoryEntry,
  type ListDirectoryArgs,
  type ListDirectoryResult,
  type ReadDocumentArgs,
  type ReadDocumentResult,
  type RecoveryPathArgs,
  type SaveRecoveryArgs,
  type WorkspaceChanged,
  type WorkspaceDocument,
  type WorkspaceState
} from '@chaptale/ipc-contract';

import type { SettingsService } from '../../core/settings/service';
import { WorkspaceLayoutService } from '../../core/workspace/layout';
import { createTextAtomically, writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { DEFAULT_IGNORED_DIRS, resolveWithinCwd } from '../../infra/filesystem/path-guard';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { isSafeRelativePath, validateEntryName } from './entry-path';
import { DocumentReadError, readDocumentSnapshot, type DocumentReadOptions } from './read-document';
import type { RecoveryStore } from './recovery';
import type { WorkspaceWatcher } from './watcher';

/** 作品文件操作；根路径只认设置服务，Renderer 只能提供相对路径与预期作品身份。 */
export class WorkspaceService {
  constructor(
    private readonly settings: Pick<SettingsService, 'getStorageContext'>,
    private readonly documentReadOptions: DocumentReadOptions = {},
    private readonly watcher?: WorkspaceWatcher,
    private readonly recovery?: RecoveryStore,
    private readonly beforeDocumentWrite?: (
      next: Pick<WriteDocumentArgs, 'rootPath' | 'relativePath' | 'content'>,
      previous?: WorkspaceDocument
    ) => Promise<void>
  ) {}

  async getState(): Promise<WorkspaceState> {
    const context = await this.settings.getStorageContext();
    const rootPath = context.workspacePath ?? null;
    await this.watcher?.setRoot(rootPath);
    const hasChaptaleMetadata = rootPath
      ? await fs.stat(path.join(rootPath, '.chaptale')).then(
          stat => stat.isDirectory(),
          () => false
        )
      : false;
    const layout = rootPath ? await new WorkspaceLayoutService().read(rootPath) : null;
    return {
      rootPath,
      displayName: layout?.manifest?.title ?? (rootPath ? path.basename(rootPath) : null),
      hasChaptaleMetadata
    };
  }

  onChange(listener: (event: WorkspaceChanged) => void) {
    return this.watcher?.onChange(listener) ?? (() => undefined);
  }

  async dispose() {
    await this.watcher?.dispose();
  }

  private async assertWorkspace(rootPath: string) {
    const context = await this.settings.getStorageContext();
    if (context.workspacePath !== rootPath) throw new Error('作品已经切换');
  }

  async listRecoveries(rootPath: string) {
    await this.assertWorkspace(rootPath);
    return this.recovery?.list(rootPath) ?? [];
  }

  async readRecovery(args: RecoveryPathArgs) {
    await this.assertWorkspace(args.rootPath);
    return this.recovery?.read(args.rootPath, args.relativePath) ?? null;
  }

  async saveRecovery(args: SaveRecoveryArgs) {
    await this.assertWorkspace(args.rootPath);
    if (!isSafeRelativePath(args.relativePath)) throw new Error('恢复草稿路径不合法');
    if (!this.recovery) throw new Error('恢复存储不可用');
    await this.recovery.save(args);
  }

  async discardRecovery(args: RecoveryPathArgs) {
    await this.assertWorkspace(args.rootPath);
    await this.recovery?.discard(args.rootPath, args.relativePath);
  }

  async listDirectory(args: ListDirectoryArgs): Promise<ListDirectoryResult> {
    const { rootPath } = await this.getState();
    if (!rootPath) return { ok: false, code: 'no-workspace', message: '请先打开作品' };
    if (args.relativePath && !isSafeRelativePath(args.relativePath)) {
      return { ok: false, code: 'outside-workspace', message: '只能读取作品内的相对路径' };
    }
    try {
      const directory = await resolveWithinCwd(rootPath, args.relativePath);
      const children = await fs.readdir(directory, { withFileTypes: true });
      const entries: DirectoryEntry[] = [];
      for (const child of children) {
        if (DEFAULT_IGNORED_DIRS.has(child.name) || (!args.includeInternal && child.name === '.chaptale')) continue;
        // 不跟随链接：避免越界目录及递归展开形成环，作品根本身仍可为链接。
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
        code: message.includes('作品之外')
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

  async readDocument(args: ReadDocumentArgs): Promise<ReadDocumentResult> {
    try {
      const context = await this.settings.getStorageContext();
      const rootPath = context.workspacePath;
      if (!rootPath) return { ok: false, code: 'no-workspace', message: '请先打开作品' };
      if (args.rootPath !== rootPath) {
        return { ok: false, code: 'workspace-changed', message: '作品已经切换，请重新打开文件' };
      }
      if (!isSafeRelativePath(args.relativePath)) {
        return { ok: false, code: 'outside-workspace', message: '只能读取作品内的相对路径' };
      }

      const document = await readDocumentSnapshot({ ...args, rootPath }, this.documentReadOptions);
      const current = await this.settings.getStorageContext();
      if (current.workspacePath !== rootPath) {
        return { ok: false, code: 'workspace-changed', message: '作品已经切换，已丢弃旧文件读取结果' };
      }
      return { ok: true, document };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof DocumentReadError) return { ok: false, code: error.code, message };
      const code = (error as NodeJS.ErrnoException).code;
      return {
        ok: false,
        code: message.includes('作品之外')
          ? 'outside-workspace'
          : code === 'ENOENT' || code === 'ENOTDIR'
            ? 'not-found'
            : code === 'EISDIR'
              ? 'not-a-file'
              : 'read-failed',
        message
      };
    }
  }

  async writeDocument(args: WriteDocumentArgs): Promise<WriteDocumentResult> {
    if (!args.content.isWellFormed() || args.content.includes('\0')) {
      return { ok: false, code: 'invalid-content', message: '正文包含无效 Unicode 或 NUL，未写入文件' };
    }
    if (Buffer.byteLength(args.content, 'utf8') > MAX_DOCUMENT_BYTES) {
      return { ok: false, code: 'too-large', message: '正文超过 100 MiB 保存上限' };
    }
    if (!isSafeRelativePath(args.relativePath)) {
      return { ok: false, code: 'outside-workspace', message: '只能保存作品内的相对路径' };
    }
    try {
      const context = await this.settings.getStorageContext();
      if (context.workspacePath !== args.rootPath) {
        return { ok: false, code: 'workspace-changed', message: '作品已变化，未保存旧作品文件' };
      }
      const target = await resolveWithinCwd(args.rootPath, args.relativePath);
      return await withFileWriteLock(target, async () => {
        const before = await this.readDocument({ rootPath: args.rootPath, relativePath: args.relativePath });
        if (!before.ok) return before;
        if (before.document.contentHash !== args.expectedHash) {
          return { ok: false, code: 'conflict', message: '磁盘文件已更新，本地修改未覆盖外部内容' };
        }
        if (args.preservePrevious) {
          if (!this.recovery) return { ok: false, code: 'write-failed', message: '无法保留外部版本，未覆盖文件' };
          await this.recovery.preserve(args.rootPath, args.relativePath, before.document.content);
        }
        if (this.beforeDocumentWrite) {
          await this.beforeDocumentWrite(args, before.document);
          const checked = await this.readDocument({ rootPath: args.rootPath, relativePath: args.relativePath });
          if (!checked.ok) return checked;
          if (checked.document.contentHash !== args.expectedHash)
            return { ok: false, code: 'conflict', message: '留档期间正文发生变化，未覆盖外部内容' };
        }
        await resolveWithinCwd(args.rootPath, args.relativePath);
        await writeTextAtomically(target, args.content);
        const saved = await this.readDocument({ rootPath: args.rootPath, relativePath: args.relativePath });
        if (saved.ok && saved.document.content !== args.content) {
          return { ok: false, code: 'conflict', message: '保存后文件再次发生变化，本地缓冲仍保留' };
        }
        return saved;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code: message.includes('作品之外') ? 'outside-workspace' : 'write-failed', message };
    }
  }

  async getLayout(rootPath: string): Promise<WorkspaceLayoutResult> {
    const context = await this.settings.getStorageContext();
    if (context.workspacePath !== rootPath) {
      return { ok: false, message: '作品已经切换' };
    }
    return { ok: true, layout: await new WorkspaceLayoutService().read(rootPath) };
  }

  async createChapter(args: CreateChapterArgs): Promise<ReadDocumentResult> {
    try {
      const layout = await this.getLayout(args.rootPath);
      if (!layout.ok) return { ok: false, code: 'workspace-changed', message: layout.message };
      const nameError = validateEntryName(args.filename);
      if (nameError || !args.filename.endsWith('.md') || !args.title.trim()) {
        return { ok: false, code: 'read-failed', message: nameError ?? '章节需要标题和 .md 文件名' };
      }
      const directory = args.relativeDirectory ?? layout.layout.roles.manuscript.relativePath;
      if (!isSafeRelativePath(directory) || directory.split('/')[0] === '.chaptale') {
        return { ok: false, code: 'outside-workspace', message: '章节只能建在作者目录中' };
      }
      const relativePath = `${directory}/${args.filename}`;
      const target = await resolveWithinCwd(args.rootPath, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const head = stringify({
        id: randomUUID(),
        kind: 'chapter',
        title: args.title.trim(),
        order: args.order,
        status: 'draft',
        template: 'chapter'
      });
      await withFileWriteLock(target, async () => {
        const current = await this.getLayout(args.rootPath);
        if (!current.ok) throw new Error(current.message);
        await resolveWithinCwd(args.rootPath, relativePath);
        await createTextAtomically(target, `---\n${head}---\n# ${args.title.trim()}\n\n`);
      });
      return this.readDocument({ rootPath: args.rootPath, relativePath });
    } catch (error) {
      return {
        ok: false,
        code: 'read-failed',
        message: (error as NodeJS.ErrnoException).code === 'EEXIST' ? '同名章节已存在' : String(error)
      };
    }
  }

  async createDocument(args: { rootPath: string; relativePath: string; content: string }): Promise<ReadDocumentResult> {
    try {
      await this.assertWorkspace(args.rootPath);
      if (!isSafeRelativePath(args.relativePath) || args.relativePath.split('/').some(part => part.startsWith('.')))
        throw new Error('新建文档只能位于作者目录');
      for (const part of args.relativePath.split('/')) {
        const error = validateEntryName(part);
        if (error) throw new Error(error);
      }
      if (
        !args.content.isWellFormed() ||
        args.content.includes('\0') ||
        Buffer.byteLength(args.content) > 8 * 1024 * 1024
      )
        throw new Error('文档内容无效或超过 8 MiB');
      const target = await resolveWithinCwd(args.rootPath, args.relativePath);
      await withFileWriteLock(target, async () => {
        await this.assertWorkspace(args.rootPath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await resolveWithinCwd(args.rootPath, args.relativePath);
        try {
          await fs.lstat(target);
          throw Object.assign(new Error('同名文件已存在'), { code: 'EEXIST' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await this.beforeDocumentWrite?.(args);
        await createTextAtomically(target, args.content);
      });
      return this.readDocument(args);
    } catch (error) {
      return {
        ok: false,
        code: 'read-failed',
        message: (error as NodeJS.ErrnoException).code === 'EEXIST' ? '同名文件已存在' : String(error)
      };
    }
  }

  /**
   * 在作品内新建空文件或目录。
   *
   * 只做「不存在则创建」：已存在一律报错而不是覆盖——这里的目标是作者的正文，
   * 静默截断一个同名章节比让用户改个名字糟糕得多。
   */
  async createEntry(args: CreateEntryArgs): Promise<CreateEntryResult> {
    const { rootPath } = await this.getState();
    if (!rootPath) return { ok: false, code: 'no-workspace', message: '请先打开作品' };
    if (!isSafeRelativePath(args.relativePath)) {
      return { ok: false, code: 'outside-workspace', message: '只能在作品内新建' };
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

      if (message.includes('作品之外')) return { ok: false, code: 'outside-workspace', message };
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
