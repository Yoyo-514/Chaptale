import path from 'node:path';

import { resolveWorkspaceMemoryPaths } from '../../../core/memory-layout/paths';
import { WorkspaceLayoutService } from '../../../core/workspace/layout';
import type { IndexDiagnostic, IndexSourceResolver, IndexSourceRoot } from '../types';

const ASSET_ROLES = ['outline', 'world', 'characters', 'threads'] as const;

/** 检索与编辑器共用目录角色解析，不在检索层复制清单规则。 */
export class WorkspaceIndexSourceResolver implements IndexSourceResolver {
  async resolve(cwd: string): Promise<{ roots: IndexSourceRoot[]; diagnostics: IndexDiagnostic[] }> {
    const workspacePath = path.resolve(cwd);
    const layout = await new WorkspaceLayoutService().read(workspacePath);
    const diagnostics: IndexDiagnostic[] = layout.diagnostics.map(message => ({ code: 'config-invalid', message }));
    const roots: IndexSourceRoot[] = ASSET_ROLES.map(role => ({
      domain: 'canon',
      role,
      absolutePath: path.join(workspacePath, layout.roles[role].relativePath)
    }));

    const memoryPaths = resolveWorkspaceMemoryPaths(workspacePath);
    roots.push(
      { domain: 'notes', role: 'notes', absolutePath: memoryPaths.notesDir },
      { domain: 'summaries', role: 'summaries', absolutePath: memoryPaths.summariesDir }
    );

    return { roots, diagnostics };
  }
}
