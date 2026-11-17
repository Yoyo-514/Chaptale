import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { FsReadToolPermission } from '../protocol.ts';

/** 原生 read、ls、find、grep 的目标路径参数；ls、find、grep 省略时为工作目录。 */
const pathTools = new Set(['read', 'ls', 'find', 'grep']);

export function sameFsPath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function inside(root: string, target: string): boolean {
  const left = process.platform === 'win32' ? root.toLowerCase() : root;
  const right = process.platform === 'win32' ? target.toLowerCase() : target;
  const path = relative(left, right);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** 目标尚不存在时取最近存在的祖先的真实路径再拼回剩余段，经链接指向目录外的路径按目录外判定。 */
async function realTarget(target: string): Promise<string> {
  const missing: string[] = [];
  let probe = target;
  while (true) {
    try {
      return join(await realpath(probe), ...missing);
    } catch (error) {
      const parent = dirname(probe);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === probe) throw error;
      missing.unshift(basename(probe));
      probe = parent;
    }
  }
}

export interface FsReadInspection {
  inCwd: boolean;
  target?: string;
  remember?: {
    capability: 'fs_read';
    path: string;
    pathKind: 'directory' | 'file';
  };
}

/**
 * 解析原生只读文件工具的目标路径与可记住范围：
 * - 工作目录内的调用直接放行；
 * - pi 自行展开的 `~`、`@`、`file://` 与 Windows 斜杠盘符写法无法静态对齐，只开放“仅此次”；
 * - 单文件记住其真实父目录（父目录为盘符根或用户主目录时降级只记该单文件）；
 * - 目录记住其真实目录（盘符根或用户主目录本身只开放“仅此次”）。
 */
export async function inspectFsReadTarget(
  toolName: string,
  input: unknown,
  cwd: string,
  options?: { homeDir?: string }
): Promise<FsReadInspection | null> {
  if (!pathTools.has(toolName)) return null;
  const path = (input as { path?: unknown } | null)?.path ?? '';
  if (typeof path !== 'string' || /^[~@]|^file:|[\u00A0\u2000-\u200A\u202F\u205F\u3000]/.test(path)) {
    return { inCwd: false };
  }
  if (toolName === 'read' && !path.trim()) return { inCwd: false };
  if (process.platform === 'win32' && /^[\\/]/.test(path)) return { inCwd: false };
  try {
    const [realCwd, target] = await Promise.all([realpath(cwd), realTarget(resolve(cwd, path))]);
    if (inside(realCwd, target)) return { inCwd: true, target };
    const info = await stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const rawHome = resolve(options?.homeDir ?? homedir());
    const realHome = await realTarget(rawHome).catch(() => rawHome);
    const isBroadDirectory = (dir: string) => dirname(dir) === dir || sameFsPath(dir, realHome);
    const isFile = info ? !info.isDirectory() : toolName === 'read';
    if (isFile) {
      const parent = dirname(target);
      return {
        inCwd: false,
        target,
        remember: isBroadDirectory(parent)
          ? { capability: 'fs_read', path: target, pathKind: 'file' }
          : { capability: 'fs_read', path: parent, pathKind: 'directory' }
      };
    }
    return {
      inCwd: false,
      target,
      remember: isBroadDirectory(target) ? undefined : { capability: 'fs_read', path: target, pathKind: 'directory' }
    };
  } catch {
    return { inCwd: false };
  }
}

export function matchesFsReadPermission(
  rule: Pick<FsReadToolPermission, 'path' | 'pathKind'>,
  target: string
): boolean {
  return rule.pathKind === 'file' ? sameFsPath(rule.path, target) : inside(rule.path, target);
}

/** 原生文件工具的目标是否落在工作目录内，落在目录内的调用不逐次询问。 */
export async function targetsCwd(toolName: string, input: unknown, cwd: string): Promise<boolean> {
  return (await inspectFsReadTarget(toolName, input, cwd))?.inCwd === true;
}
