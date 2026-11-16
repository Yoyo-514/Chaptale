import { resolve } from 'node:path';

import type { ManagedSkillsSnapshot } from '@chaptale/agent-host/protocol';

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** 校验待打开路径属于宿主当前登记的技能根目录、技能条目或诊断文件，阻止任意路径透传给 shell。 */
export function resolveAuthorizedSkillRevealPath(
  snapshot: ManagedSkillsSnapshot,
  filePath: string
): { kind: 'directory' | 'item'; path: string } {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('技能路径不能为空');
  }
  if (samePath(snapshot.globalDir, filePath)) {
    return { kind: 'directory', path: snapshot.globalDir };
  }
  if (snapshot.workDir && samePath(snapshot.workDir, filePath)) {
    return { kind: 'directory', path: snapshot.workDir };
  }
  for (const skill of snapshot.skills) {
    if (samePath(skill.filePath, filePath)) return { kind: 'item', path: skill.filePath };
    if (samePath(skill.baseDir, filePath)) return { kind: 'item', path: skill.filePath };
  }
  for (const diag of snapshot.diagnostics) {
    if (diag.path && samePath(diag.path, filePath)) return { kind: 'item', path: diag.path };
  }
  throw new Error('目标路径未在技能列表中登记');
}
