import { randomUUID } from 'node:crypto';

import type { Document, Entry, EntrySnapshot, Revision } from '../contracts/content.ts';
import { EntryLocationConflictError } from '../errors.ts';
import type { CommitEffect, WorkRepository } from '../repository.ts';
import { countDocumentWords } from '../text.ts';
import { assertEntryParent } from './entries.ts';

export interface SnapshotCommit {
  workId: string;
  commandId: string;
  parameters: readonly unknown[];
  base: EntrySnapshot | null;
  candidate: EntrySnapshot;
  source: 'agent' | 'review';
}

/** 快照改变目录位置时，回执记录原位置供事件投影。 */
export function snapshotEffect(base: EntrySnapshot | null, candidate: EntrySnapshot): CommitEffect {
  return base !== null && (base.parentId !== candidate.parentId || base.position !== candidate.position)
    ? { kind: 'move', from: { parentId: base.parentId, position: base.position } }
    : { kind: 'entry' };
}

/** 在调用方已开启的作品事务中写入一份快照，复核基线与目录约束并生成修订；多份快照按调用顺序共用同一事务和回执。 */
export function applySnapshot(
  work: WorkRepository,
  input: Pick<SnapshotCommit, 'base' | 'candidate' | 'source'>
): Entry {
  const { base, candidate, source } = input;
  const current = work.getEntry(candidate.id);
  if (base === null ? current !== undefined : current?.revisionId !== base.revisionId)
    throw new Error('正式内容已有变化，请刷新审阅内容');
  if (base && current && (current.parentId !== base.parentId || current.position !== base.position))
    throw new EntryLocationConflictError(current.parentId, current.position);
  assertEntryParent(work.listEntries(), candidate);
  const saved: EntrySnapshot = {
    ...candidate,
    revisionId: randomUUID(),
    updatedAt: Date.now(),
    wordCount: candidate.content === null ? 0 : countDocumentWords(candidate.content)
  };
  const revision = revisionFor(saved, base?.revisionId ?? null, source);
  if (!current) {
    const inserted = { ...saved, position: work.nextPosition(saved.section, saved.parentId) };
    work.insertEntry(inserted, revision);
    if (inserted.position !== saved.position) work.relocateEntry(inserted, saved.parentId, saved.position);
  } else {
    if (snapshotEffect(base, candidate).kind === 'move') work.relocateEntry(current, saved.parentId, saved.position);
    if (saved.kind === 'document') work.updateDocument(saved as Document, revision);
    else work.updateTitle(saved, revision);
  }
  const { content: _content, ...entry } = saved;
  return entry;
}

export function revisionFor(
  snapshot: EntrySnapshot,
  parentRevisionId: string | null,
  source: Revision['source'] = 'author'
): Revision {
  return {
    id: snapshot.revisionId,
    entryId: snapshot.id,
    parentRevisionId,
    source,
    snapshot,
    createdAt: snapshot.updatedAt
  };
}
