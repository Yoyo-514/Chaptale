import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { OneDriveFolder, WorkspaceSyncState } from '@chaptale/ipc-contract';

const locations = [
  { variable: 'OneDriveConsumer', kind: 'personal' },
  { variable: 'OneDriveCommercial', kind: 'business' },
  { variable: 'OneDrive', kind: 'default' }
] as const;

const pathKey = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);

export async function resolveDirectory(target: string): Promise<string> {
  if (!path.isAbsolute(target)) throw new Error('存放位置必须是绝对目录路径');
  const resolved = await realpath(target);
  if (!(await stat(resolved)).isDirectory()) throw new Error('存放位置不是目录');
  return resolved;
}

export async function readOneDriveFolders(environment: NodeJS.ProcessEnv = process.env): Promise<OneDriveFolder[]> {
  const folders: OneDriveFolder[] = [];
  const seen = new Set<string>();
  for (const { variable, kind } of locations) {
    const target = environment[variable];
    if (!target) continue;
    let folder: OneDriveFolder;
    try {
      folder = { path: await resolveDirectory(target), kind, available: true };
    } catch (error) {
      folder = { path: target, kind, available: false, error: error instanceof Error ? error.message : String(error) };
    }
    const key = pathKey(folder.path);
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push(folder);
  }
  return folders;
}

export async function inspectWorkspaceSync(
  rootPath: string | null,
  environment: NodeJS.ProcessEnv = process.env
): Promise<WorkspaceSyncState> {
  const folders = await readOneDriveFolders(environment);
  const state: WorkspaceSyncState = {
    rootPath,
    folders,
    oneDriveRoot: null,
    remoteState: 'unknown',
    checkedAt: new Date().toISOString()
  };
  if (!rootPath) return state;
  try {
    const actual = await resolveDirectory(rootPath);
    const matches = folders.filter(folder => {
      if (!folder.available) return false;
      const relative = path.relative(folder.path, actual);
      return (
        relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    });
    state.oneDriveRoot = matches.toSorted((a, b) => b.path.length - a.path.length)[0]?.path ?? null;
  } catch (error) {
    state.workspaceError = error instanceof Error ? error.message : String(error);
  }
  return state;
}

/** 打开系统目录前重新检测，只接受配置中存在的同步根，不扩大 shell 的任意路径权限。 */
export async function resolveOneDriveFolder(target: string, environment: NodeJS.ProcessEnv = process.env) {
  const actual = await resolveDirectory(target);
  const folders = await readOneDriveFolders(environment);
  const folder = folders.find(item => item.available && pathKey(item.path) === pathKey(actual));
  if (!folder) throw new Error('OneDrive 目录已变化或不在本机配置中，请刷新后重试');
  return folder.path;
}
