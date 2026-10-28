import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

import type { Document, Entry, TrashBatch, TrashBatchInput, TrashEntriesInput, TrashImpact } from './contracts.ts';
import type { CreationRepository } from './repository.ts';
import type { ReviewService } from './review/service.ts';
import type { CreationService } from './service.ts';

/**
 * 作品回收站：删除状态与回执在作品库一次提交，再凭回执处理本机库中的待审修改和恢复草稿。
 * 两库独立提交，本机一侧失败时由审阅恢复按回收站状态补齐。
 */
export class TrashService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;

  constructor(repository: CreationRepository, creation: CreationService, review: ReviewService) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
  }

  list(workId: string): TrashBatch[] {
    return this.repository.listTrash(workId);
  }

  preview(workId: string, entryIds: string[]): TrashImpact {
    const removed = subtree(this.repository.listEntries(workId), entryIds);
    return { entryCount: removed.size, pendingCount: this.review.countAffected(workId, removed) };
  }

  trash(input: TrashEntriesInput): Entry[] {
    const trashed = this.creation.commit(
      input.workId,
      input.commandId,
      ['trashEntries', input.workId, input.entryIds],
      { kind: 'entries' },
      () => {
        const entries = this.repository.listEntries(input.workId);
        for (const id of input.entryIds) {
          if (!entries.some(entry => entry.id === id)) {
            if (this.repository.isTrashed(input.workId, id)) throw new Error('条目在回收站中');
            throw new Error('条目不存在');
          }
        }
        const ids = new Set(this.repository.trashEntries(input.workId, input.entryIds, randomUUID(), Date.now()));
        return entries.filter(entry => ids.has(entry.id));
      }
    );
    this.review.rejectTrashed(input.workId);
    return trashed;
  }

  restore(input: TrashBatchInput & { batchId: string }): Entry[] {
    return this.creation.commit(
      input.workId,
      input.commandId,
      ['restoreTrash', input.workId, input.batchId],
      { kind: 'entries' },
      () => {
        const ids = new Set(this.repository.restoreTrash(input.workId, input.batchId));
        if (!ids.size) throw new Error('回收站中没有这批内容');
        return this.repository.listEntries(input.workId).filter(entry => ids.has(entry.id));
      }
    );
  }

  purge(input: TrashBatchInput): Entry[] {
    const purged = this.creation.commit(
      input.workId,
      input.commandId,
      ['purgeTrash', input.workId, input.batchId],
      { kind: 'entries' },
      () => {
        const batchIds = input.batchId === null ? this.repository.listTrashBatchIds(input.workId) : [input.batchId];
        const entries = batchIds.flatMap(batchId => this.repository.purgeTrash(input.workId, batchId));
        if (input.batchId !== null && !entries.length) throw new Error('回收站中没有这批内容');
        return entries;
      }
    );
    this.repository.clearDrafts(
      input.workId,
      purged.filter(entry => entry.kind === 'document').map(entry => entry.id)
    );
    for (const entry of purged)
      if (entry.kind === 'file')
        rmSync(this.repository.entryFileDir(input.workId, entry.id), { recursive: true, force: true });
    return purged;
  }

  readDocument(workId: string, documentId: string): Document {
    const document = this.repository.getTrashedDocument(workId, documentId);
    if (!document) throw new Error('回收站中没有这篇文稿');
    return document;
  }
}

function subtree(entries: Entry[], rootIds: readonly string[]): Set<string> {
  const ids = new Set(rootIds.filter(id => entries.some(entry => entry.id === id)));
  let grown = true;
  while (grown) {
    grown = false;
    for (const entry of entries) {
      if (entry.parentId !== null && ids.has(entry.parentId) && !ids.has(entry.id)) {
        ids.add(entry.id);
        grown = true;
      }
    }
  }
  return ids;
}
