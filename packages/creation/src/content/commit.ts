import { randomUUID } from 'node:crypto';

import type { Document, Entry, EntrySnapshot, Revision } from '../contracts/content.ts';
import { EntryLocationConflictError } from '../errors.ts';
import type { CommitEffect, CreationRepository } from '../repository.ts';
import { countDocumentWords } from '../text.ts';
import { assertEntryParent } from './entries.ts';

type CommitEntry = (
  workId: string,
  commandId: string,
  parameters: readonly unknown[],
  effect: CommitEffect,
  apply: () => Entry
) => Entry;
export interface SnapshotCommit {
  workId: string;
  commandId: string;
  parameters: readonly unknown[];
  base: EntrySnapshot | null;
  candidate: EntrySnapshot;
  source: 'agent' | 'review';
}

/** 正式内容聚合的提交边界：同一事务复核基线、目录约束并生成修订。 */
export function commitSnapshot(repository: CreationRepository, commit: CommitEntry, input: SnapshotCommit): Entry {
  const { workId, commandId, base, candidate, source } = input;
  const moving = base !== null && (base.parentId !== candidate.parentId || base.position !== candidate.position);
  return commit(
    workId,
    commandId,
    input.parameters,
    moving ? { kind: 'move', from: { parentId: base.parentId, position: base.position } } : { kind: 'entry' },
    () => {
      const current = repository.getEntry(workId, candidate.id);
      if (base === null ? current !== undefined : current?.revisionId !== base.revisionId)
        throw new Error('正式内容已有变化，请刷新审阅内容');
      if (base && current && (current.parentId !== base.parentId || current.position !== base.position))
        throw new EntryLocationConflictError(current.parentId, current.position);
      assertEntryParent(repository.listEntries(workId), candidate);
      const saved: EntrySnapshot = {
        ...candidate,
        revisionId: randomUUID(),
        updatedAt: Date.now(),
        wordCount: candidate.content === null ? 0 : countDocumentWords(candidate.content)
      };
      const revision = revisionFor(saved, base?.revisionId ?? null, source);
      if (!current) {
        const inserted = { ...saved, position: repository.nextPosition(workId, saved.section, saved.parentId) };
        repository.insertEntry(workId, inserted, revision);
        if (inserted.position !== saved.position)
          repository.relocateEntry(workId, inserted, saved.parentId, saved.position);
      } else {
        if (moving) repository.relocateEntry(workId, current, saved.parentId, saved.position);
        if (saved.kind === 'document') repository.updateDocument(workId, saved as Document, revision);
        else repository.updateDirectory(workId, saved, revision);
      }
      const { content: _content, ...entry } = saved;
      return entry;
    }
  );
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
