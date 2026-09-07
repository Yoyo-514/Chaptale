import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';

import { WorkspaceRelativePathValidator, type SettlementBatch, type SettlementItem } from '@chaptale/shared';

import { resolveWithinCwd } from '../../infra/filesystem/path-guard';
import { readDocumentSnapshot } from '../workspace/read-document';

export const hash = (content: string) => createHash('sha256').update(content).digest('hex');
export const chapterKey = (relativePath: string, id?: string) =>
  hash(id ? `id:${id}` : `path:${relativePath}`).slice(0, 24);
export const summaryPath = (key: string) => `.chaptale/memory/summaries/chapters/${key}.md`;
export function batchPath(id: string) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('结算标识无效');
  return `.chaptale/memory/pending/batches/${id}.json`;
}
export async function optionalSnapshot(rootPath: string, relativePath: string) {
  try {
    const { content, contentHash } = await readDocumentSnapshot({ rootPath, relativePath, maxBytes: 10 * 1024 * 1024 });
    return { content, contentHash };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
/** 确认写入也不跟随作者目录内的链接，避免绕回内部机器数据。 */
export async function authorPath(rootPath: string, relativePath: string) {
  if (!WorkspaceRelativePathValidator.Check(relativePath) || relativePath.split('/').some(part => part.startsWith('.')))
    throw new Error('结算资产只能写入作者目录');
  const parts = relativePath.split('/');
  for (let at = 1; at <= parts.length; at++) {
    const filename = await resolveWithinCwd(rootPath, parts.slice(0, at).join('/'));
    try {
      if ((await lstat(filename)).isSymbolicLink()) throw new Error('结算目标不能包含链接');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return resolveWithinCwd(rootPath, relativePath);
}
export function assertItemTarget(batch: SettlementBatch, item: SettlementItem) {
  if (item.category === 'summary') {
    if (item.id !== 'summary' || item.targetPath !== summaryPath(batch.chapterKey)) throw new Error('摘要路径无效');
  } else if (item.category === 'timeline') {
    if (!/^event-\d+$/.test(item.id) || item.targetPath !== `${batch.worldDirectory}/时间线/${batch.id}-${item.id}.md`)
      throw new Error('时间线落点无效');
  } else if (
    !batch.sources.some(
      source =>
        source.sourcePath === item.targetPath &&
        source.kind === item.category &&
        source.contentHash === item.baseline?.contentHash
    ) ||
    !item.baseline
  ) {
    throw new Error('资产不在结算参考中');
  }
  if (item.baseline && hash(item.baseline.content) !== item.baseline.contentHash) throw new Error('提议基线损坏');
}
