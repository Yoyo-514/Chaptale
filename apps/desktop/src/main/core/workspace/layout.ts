import { readFile, stat } from 'node:fs/promises';

import {
  ChaptaleManifestValidator,
  WORKSPACE_ROLES,
  WorkspaceRelativePathValidator,
  type WorkspaceLayout,
  type WorkspaceRole
} from '@chaptale/shared';

import { resolveWithinCwd } from '../../infra/filesystem/path-guard';

export const DEFAULT_WORKSPACE_DIRS: Record<WorkspaceRole, string> = {
  manuscript: '正文',
  outline: '大纲',
  world: '设定',
  characters: '角色',
  threads: '伏笔',
  drafts: '草稿',
  inspiration: '灵感',
  templates: '模板'
};

/** 只探测映射与现有目录；读取布局从不创建作者文件夹。 */
export class WorkspaceLayoutService {
  async read(rootPath: string): Promise<WorkspaceLayout> {
    const diagnostics: string[] = [];
    let raw: unknown;
    try {
      const file = await resolveWithinCwd(rootPath, 'chaptale.json');
      const info = await stat(file);
      if (info.size > 64 * 1024) throw new Error('清单超过 64 KiB');
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(`chaptale.json: ${String(error)}`);
    }
    const manifest = ChaptaleManifestValidator.Check(raw) ? raw : null;
    if (raw && !manifest) diagnostics.push('作品清单不完整，仅使用合法的目录映射');
    const dirs =
      raw && typeof raw === 'object' && 'dirs' in raw && raw.dirs && typeof raw.dirs === 'object'
        ? (raw.dirs as Record<string, unknown>)
        : {};
    const roles = {} as WorkspaceLayout['roles'];
    for (const role of WORKSPACE_ROLES) {
      const configured = dirs[role];
      let relativePath = DEFAULT_WORKSPACE_DIRS[role];
      if (configured !== undefined) {
        if (WorkspaceRelativePathValidator.Check(configured) && configured.split('/')[0] !== '.chaptale') {
          relativePath = configured;
        } else diagnostics.push(`${role} 目录不合法，使用默认目录`);
      }
      let exists = false;
      try {
        const target = await resolveWithinCwd(rootPath, relativePath);
        exists = (await stat(target)).isDirectory();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(`${role}: ${String(error)}`);
      }
      roles[role] = { relativePath, exists };
    }
    return { rootPath, manifest, roles, diagnostics };
  }

  async resolve(rootPath: string, role: WorkspaceRole): Promise<string> {
    const layout = await this.read(rootPath);
    return resolveWithinCwd(rootPath, layout.roles[role].relativePath);
  }
}
