import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceMemoryPaths } from '../../memory/paths';
import type { IndexDiagnostic, IndexSourceResolver, IndexSourceRoot } from '../types';

const DEFAULT_ASSET_DIRS = {
  outline: '大纲',
  world: '设定',
  characters: '角色',
  threads: '伏笔'
} as const;

type AssetRole = keyof typeof DEFAULT_ASSET_DIRS;

/** 当前目录约定的适配器；未来布局服务只需替换此端口，不让索引内核感知路径规则。 */
export class WorkspaceIndexSourceResolver implements IndexSourceResolver {
  async resolve(cwd: string): Promise<{ roots: IndexSourceRoot[]; diagnostics: IndexDiagnostic[] }> {
    const workspacePath = path.resolve(cwd);
    const diagnostics: IndexDiagnostic[] = [];
    const configuredDirs = await readConfiguredDirs(workspacePath, diagnostics);
    const roots: IndexSourceRoot[] = [];

    for (const role of Object.keys(DEFAULT_ASSET_DIRS) as AssetRole[]) {
      const fallback = DEFAULT_ASSET_DIRS[role];
      const configured = configuredDirs?.[role];
      const relativeDir = typeof configured === 'string' && configured.trim() ? configured.trim() : fallback;
      const absolutePath = path.resolve(workspacePath, relativeDir);

      if (!isWithin(workspacePath, absolutePath)) {
        diagnostics.push({
          code: 'source-outside-workspace',
          message: `索引目录越过 workspace，已回退默认目录：${relativeDir}`,
          role
        });
        roots.push({ domain: 'canon', role, absolutePath: path.join(workspacePath, fallback) });
      } else {
        roots.push({ domain: 'canon', role, absolutePath });
      }
    }

    const memoryPaths = resolveWorkspaceMemoryPaths(workspacePath);
    roots.push(
      { domain: 'notes', role: 'notes', absolutePath: memoryPaths.notesDir },
      { domain: 'summaries', role: 'summaries', absolutePath: memoryPaths.summariesDir }
    );

    return { roots, diagnostics };
  }
}

async function readConfiguredDirs(
  cwd: string,
  diagnostics: IndexDiagnostic[]
): Promise<Partial<Record<AssetRole, unknown>> | undefined> {
  try {
    const raw = await fs.readFile(path.join(cwd, 'chaptale.json'), 'utf8');
    const parsed = JSON.parse(raw) as { dirs?: unknown };
    if (!parsed || typeof parsed !== 'object' || !parsed.dirs || typeof parsed.dirs !== 'object') return undefined;
    return parsed.dirs as Partial<Record<AssetRole, unknown>>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    diagnostics.push({ code: 'config-invalid', message: `chaptale.json 读取失败：${toMessage(error)}` });
    return undefined;
  }
}

/** 配置目录只能落在 workspace 内，避免索引任意本机文件。 */
function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
