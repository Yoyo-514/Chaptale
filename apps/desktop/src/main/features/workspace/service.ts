import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { DirectoryEntry, ListDirectoryArgs, ListDirectoryResult, WorkspaceState } from '@chaptale/ipc-contract';

import type { SettingsService } from '../../core/settings/service';
import { DEFAULT_IGNORED_DIRS, resolveWithinCwd } from '../../infra/filesystem/path-guard';

/** 工作区状态与目录单层枚举；根路径只认设置服务，正文不在此读取。 */
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
    if (
      args.relativePath &&
      (path.isAbsolute(args.relativePath) ||
        /[\\:\0]/.test(args.relativePath) ||
        args.relativePath.split('/').some(part => !part || part === '.' || part === '..'))
    ) {
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
          relativePath: args.relativePath ? `${args.relativePath}/${child.name}` : child.name,
          kind: child.isDirectory() ? 'directory' : 'file'
        });
      }
      entries.sort(
        (a, b) =>
          Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
          a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      );
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
}
