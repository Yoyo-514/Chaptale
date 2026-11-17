import type {
  FsReadToolPermission,
  McpToolPermission,
  ToolPermission,
  ToolPermissionScope
} from '../protocol/index.ts';
import { sameFsPath } from './fs-read.ts';

/** 待保存的放行规则；ID 由设置存储分配。 */
export type ToolPermissionDraft = Omit<FsReadToolPermission, 'id'> | Omit<McpToolPermission, 'id'>;

function normalizePermissionScope(scope: ToolPermissionScope): ToolPermissionScope {
  if (scope.kind === 'session' && typeof scope.sessionId === 'string' && scope.sessionId.trim()) {
    return { kind: 'session', sessionId: scope.sessionId };
  }
  if (scope.kind === 'work' && typeof scope.workId === 'string' && scope.workId.trim()) {
    return { kind: 'work', workId: scope.workId };
  }
  throw new Error('工具授权作用域无效');
}

/** 校验从设置文件读入或即将保存的规则；格式不对时拒绝，不猜测修复。 */
export function normalizeToolPermission(value: ToolPermission): ToolPermission {
  if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('工具授权需要稳定 ID');
  const scope = normalizePermissionScope(value.scope);
  if (value.capability === 'fs_read') {
    if (typeof value.path !== 'string' || !value.path.trim()) throw new Error('工具授权需要路径');
    if (value.pathKind !== 'directory' && value.pathKind !== 'file') throw new Error('工具授权路径类型无效');
    return { id: value.id, scope, capability: 'fs_read', path: value.path, pathKind: value.pathKind };
  }
  if (value.capability === 'mcp') {
    const { serverScope, serverWorkId, serverName, serverFingerprint, toolName } = value;
    const text = (item: unknown) => typeof item === 'string' && item.trim() !== '';
    if (
      !(serverScope === 'global' ? serverWorkId === null : serverScope === 'work' && text(serverWorkId)) ||
      !text(serverName) ||
      !text(serverFingerprint) ||
      (toolName !== undefined && !text(toolName))
    ) {
      throw new Error('MCP 工具授权无效');
    }
    return {
      id: value.id,
      scope,
      capability: 'mcp',
      serverScope,
      serverWorkId,
      serverName,
      serverFingerprint,
      ...(toolName !== undefined && { toolName })
    };
  }
  throw new Error('工具授权能力无效');
}

function sameScope(left: ToolPermissionScope, right: ToolPermissionScope): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === 'session'
    ? left.sessionId === (right as { kind: 'session'; sessionId: string }).sessionId
    : left.workId === (right as { kind: 'work'; workId: string }).workId;
}

export function samePermission(left: ToolPermission, right: ToolPermission): boolean {
  if (!sameScope(left.scope, right.scope)) return false;
  if (left.capability === 'fs_read') {
    return right.capability === 'fs_read' && left.pathKind === right.pathKind && sameFsPath(left.path, right.path);
  }
  return (
    right.capability === 'mcp' &&
    left.serverScope === right.serverScope &&
    left.serverWorkId === right.serverWorkId &&
    left.serverName === right.serverName &&
    left.serverFingerprint === right.serverFingerprint &&
    left.toolName === right.toolName
  );
}

/** 对这次调用生效的规则：本会话的，加上会话所属作品的。 */
export function permissionsFor(rules: ToolPermission[], sessionId: string, workId: string | null): ToolPermission[] {
  return rules.filter(item =>
    item.scope.kind === 'session' ? item.scope.sessionId === sessionId : workId !== null && item.scope.workId === workId
  );
}

/** 去掉这些会话的规则；传入 workId 时连同该作品的规则一起去掉。 */
export function withoutPermissions(
  rules: ToolPermission[],
  sessionIds: ReadonlySet<string>,
  workId?: string
): ToolPermission[] {
  return rules.filter(item =>
    item.scope.kind === 'session' ? !sessionIds.has(item.scope.sessionId) : item.scope.workId !== workId
  );
}
