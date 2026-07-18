import { createHash } from 'node:crypto';
import path from 'node:path';

function sanitizeWorkspaceLabel(workspacePath: string) {
  const baseName = path.basename(workspacePath) || 'workspace';
  // oxlint-disable-next-line no-control-regex
  return baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0, 48) || 'workspace';
}

export function toWorkspaceSessionDirName(workspacePath: string) {
  const normalized = path.resolve(workspacePath).toLowerCase();
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `${sanitizeWorkspaceLabel(workspacePath)}-${hash}`;
}
