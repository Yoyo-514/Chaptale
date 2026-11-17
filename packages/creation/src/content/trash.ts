import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

import type {
  Document,
  Entry,
  TrashBatch,
  TrashBatchInput,
  TrashEntriesInput,
  TrashImpact
} from '../contracts/index.ts';
import type { StoryRelation } from '../contracts/relations.ts';
import { chapterRemoval, trashChapterStory } from '../records/chapter-removal.ts';
import type { CreationRepository } from '../repository.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';

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
    return this.repository.work(workId).listTrash();
  }

  preview(workId: string, entryIds: string[]): TrashImpact {
    const work = this.repository.work(workId);
    const entries = work.listEntries();
    const removed = subtree(entries, entryIds);
    const story = chapterRemoval(work, entries, removed);
    const ref = (relation: StoryRelation) => ({
      relationId: relation.id,
      type: relation.type,
      resourceIds: relation.resourceIds
    });
    return {
      entryCount: removed.size,
      pendingCount: this.review.countAffected(workId, removed),
      recordCount: story.records.length,
      milestoneCount:
        story.milestones.reduce((sum, item) => sum + item.ids.length, 0) +
        story.relations.reduce((sum, relation) => sum + relation.milestones.length, 0),
      relocatedCount: story.relocated,
      relationChanges: [
        ...story.relations.map(relation => ({ ...ref(relation), change: { kind: 'removed' as const } })),
        ...story.changes.map(({ relation, fromChapterId, state }) => ({
          ...ref(relation),
          change: { kind: 'state' as const, fromChapterId, state }
        }))
      ]
    };
  }

  trash(input: TrashEntriesInput): Entry[] {
    const trashed = this.creation.commit(
      input.workId,
      input.commandId,
      ['trashEntries', input.workId, input.entryIds],
      { kind: 'entries' },
      () => {
        const work = this.repository.work(input.workId);
        const entries = work.listEntries();
        for (const id of input.entryIds) {
          if (!entries.some(entry => entry.id === id)) {
            if (work.isTrashed(id)) throw new Error('条目在回收站中');
            throw new Error('条目不存在');
          }
        }
        const batchId = randomUUID();
        const now = Date.now();
        const story = chapterRemoval(work, entries, subtree(entries, input.entryIds));
        const ids = new Set(work.trashEntries(input.entryIds, batchId, now));
        trashChapterStory(work, story, batchId, now);
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
        const work = this.repository.work(input.workId);
        if (!work.listTrashBatchIds().includes(input.batchId)) throw new Error('回收站中没有这批内容');
        const ids = new Set(work.restoreTrash(input.batchId));
        return work.listEntries().filter(entry => ids.has(entry.id));
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
        const work = this.repository.work(input.workId);
        const batchIds = work.listTrashBatchIds();
        if (input.batchId !== null && !batchIds.includes(input.batchId)) throw new Error('回收站中没有这批内容');
        return (input.batchId === null ? batchIds : [input.batchId]).flatMap(batchId => work.purgeTrash(batchId));
      }
    );
    this.repository.library.clearDrafts(
      input.workId,
      purged.filter(entry => entry.kind === 'document').map(entry => entry.id)
    );
    for (const entry of purged)
      if (entry.kind === 'file')
        rmSync(this.repository.work(input.workId).entryFileDir(entry.id), { recursive: true, force: true });
    return purged;
  }

  readDocument(workId: string, documentId: string): Document {
    const document = this.repository.work(workId).getTrashedDocument(documentId);
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
