import type { McpConfigScope } from './mcp.ts';

export type ApprovalScope = 'once' | 'session' | 'work';

export type ToolPermissionScope = { kind: 'session'; sessionId: string } | { kind: 'work'; workId: string };

export type McpApprovalRememberTarget = 'tool' | 'server';

export interface FsReadToolPermission {
  id: string;
  scope: ToolPermissionScope;
  capability: 'fs_read';
  path: string;
  pathKind: 'directory' | 'file';
}

export interface McpToolPermission {
  id: string;
  scope: ToolPermissionScope;
  capability: 'mcp';
  serverScope: McpConfigScope;
  serverWorkId: string | null;
  serverName: string;
  serverFingerprint: string;
  /** 省略表示放行该服务的全部调用；指定时仅放行对应工具（如 `search` 或 `read_mcp_resource`）。 */
  toolName?: string;
}

export type ToolPermission = FsReadToolPermission | McpToolPermission;

export interface FsReadApprovalRememberOption {
  capability: 'fs_read';
  path: string;
  pathKind: 'directory' | 'file';
  /** 会话归属有效作品时为 true，允许保存为本机作品级授权。 */
  allowWork: boolean;
}

export interface McpApprovalRememberOption {
  capability: 'mcp';
  serverScope: McpConfigScope;
  serverName: string;
  /** 授权卡片中展示的被调用工具或资源操作名。 */
  toolLabel: string;
  /** 会话归属有效作品时为 true，允许保存为本机作品级授权。 */
  allowWork: boolean;
}

export type ApprovalRememberOption = FsReadApprovalRememberOption | McpApprovalRememberOption;

export interface Approval {
  id: string;
  sessionId: string;
  toolName: string;
  input: unknown;
  cwd: string;
  /** 可记住的放行范围；路径无法静态解析或直接读取盘符根／用户主目录时为空（仅开放单次允许）。 */
  remember?: ApprovalRememberOption;
}
