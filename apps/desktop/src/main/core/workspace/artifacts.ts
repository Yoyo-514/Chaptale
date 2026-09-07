import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { WorkspaceRelativePathValidator } from '@chaptale/shared';

import { createTextAtomically } from '../../infra/filesystem/atomic-text';
import { resolveWithinCwd } from '../../infra/filesystem/path-guard';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';

/** 留档目录可以创建，但不能经内部链接写到别的作者文件或外部路径。 */
export async function resolveArtifactPath(rootPath: string, relativePath: string): Promise<string> {
  if (!WorkspaceRelativePathValidator.Check(relativePath) || !relativePath.startsWith('.chaptale/')) {
    throw new Error('留档路径必须位于作品的 .chaptale 目录');
  }
  const parts = relativePath.split('/');
  for (let count = 1; count <= parts.length; count += 1) {
    const target = await resolveWithinCwd(rootPath, parts.slice(0, count).join('/'));
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('留档路径不能包含符号链接');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return resolveWithinCwd(rootPath, relativePath);
}

export async function createArtifact(rootPath: string, relativePath: string, content: string) {
  const target = await resolveArtifactPath(rootPath, relativePath);
  await withFileWriteLock(target, async () => {
    await mkdir(path.dirname(target), { recursive: true });
    await resolveArtifactPath(rootPath, relativePath);
    await createTextAtomically(target, content);
  });
}
