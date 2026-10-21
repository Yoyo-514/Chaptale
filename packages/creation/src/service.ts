import { randomUUID } from 'node:crypto';

import { countDocumentWords } from '@chaptale/shared';

import type {
  CreateEntryInput,
  CreateWorkInput,
  CreationChanges,
  CreationCursor,
  CreationEvent,
  CreationSnapshot,
  Document,
  DraftState,
  Entry,
  MoveEntryInput,
  RenameDirectoryInput,
  Revision,
  SaveDocumentInput,
  Work,
  WriteDraftInput
} from './contracts.ts';
import { discardDraft, writeDraft } from './drafts.ts';
import { EntryLocationConflictError, RevisionConflictError } from './errors.ts';
import type { CommitEffect, CreationRepository } from './repository.ts';

/** 作品规则只依赖持久化契约；具体存储由宿主启动代码注入。 */
export class CreationService {
  private readonly repository: CreationRepository;
  private readonly listeners = new Set<{ receive: (event: CreationEvent) => void }>();

  constructor(repository: CreationRepository) {
    this.repository = repository;
  }

  snapshot(workId: string | null): CreationSnapshot {
    return this.repository.snapshot(workId);
  }

  readChanges(cursor: CreationCursor, limit: number): CreationChanges {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('事件分页数量必须是正整数');
    return this.repository.readChanges(cursor, limit);
  }

  /** 实时通知在提交后的微任务中投递；重连使用快照和分页回执续接。 */
  subscribe(listener: (event: CreationEvent) => void): () => void {
    const subscription = { receive: listener };
    this.listeners.add(subscription);
    return () => this.listeners.delete(subscription);
  }

  private commit<T extends Work | Entry>(
    workId: string | null,
    commandId: string,
    parameters: readonly unknown[],
    effect: CommitEffect,
    apply: () => T
  ): T {
    const committed = this.repository.command(workId, commandId, parameters, effect, apply);
    if (committed.fresh && this.listeners.size > 0) {
      const event = structuredClone(committed.event);
      const listeners = [...this.listeners];
      queueMicrotask(() => {
        for (const subscription of listeners) {
          if (this.listeners.has(subscription)) subscription.receive(structuredClone(event));
        }
      });
    }
    return committed.result;
  }

  createWork(input: CreateWorkInput): Work {
    return this.commit(null, input.commandId, ['createWork', input.title, input.kind], { kind: 'work' }, () => {
      const now = Date.now();
      const work: Work = { id: randomUUID(), title: input.title, kind: input.kind, createdAt: now, updatedAt: now };
      this.repository.insertWork(work);
      return work;
    });
  }

  listWorks(): Work[] {
    return this.repository.listWorks();
  }

  createEntry(input: CreateEntryInput): Entry {
    const content = input.kind === 'document' ? input.content : null;
    const format = input.kind === 'document' ? input.format : null;
    return this.commit(
      input.workId,
      input.commandId,
      ['createEntry', input.workId, input.parentId, input.section, input.kind, input.title, format, content],
      { kind: 'entry' },
      () => {
        if (input.parentId !== null) {
          const parent = this.repository.getEntry(input.workId, input.parentId);
          if (!parent || parent.kind !== 'directory' || parent.section !== input.section) {
            throw new Error('目标目录不存在或不属于当前内容区域');
          }
        }
        const now = Date.now();
        const entry: Entry = {
          id: randomUUID(),
          parentId: input.parentId,
          section: input.section,
          kind: input.kind,
          title: input.title,
          position: this.repository.nextPosition(input.workId, input.section, input.parentId),
          format,
          wordCount: content === null ? 0 : countDocumentWords(content),
          revisionId: randomUUID(),
          createdAt: now,
          updatedAt: now
        };
        const snapshot = { ...entry, content };
        this.repository.insertEntry(input.workId, snapshot, revisionFor(snapshot, null));
        return entry;
      }
    );
  }

  renameDirectory(input: RenameDirectoryInput): Entry {
    const { workId, directoryId, expectedRevisionId, title } = input;
    return this.commit(
      workId,
      input.commandId,
      ['renameDirectory', workId, directoryId, expectedRevisionId, title],
      { kind: 'entry' },
      () => {
        const current = this.repository.getEntry(workId, directoryId);
        if (!current || current.kind !== 'directory') throw new Error('目录不存在');
        if (current.revisionId !== expectedRevisionId) {
          throw new RevisionConflictError(expectedRevisionId, current.revisionId);
        }
        if (current.title === title) return current;
        const saved = { ...current, title, revisionId: randomUUID(), updatedAt: Date.now() };
        this.repository.updateDirectory(workId, saved, revisionFor({ ...saved, content: null }, current.revisionId));
        return saved;
      }
    );
  }

  moveEntry(input: MoveEntryInput): Entry {
    const { workId, entryId, parentId, beforeEntryId } = input;
    return this.commit(
      workId,
      input.commandId,
      ['moveEntry', workId, entryId, input.expectedParentId, input.expectedPosition, parentId, beforeEntryId],
      { kind: 'move', from: { parentId: input.expectedParentId, position: input.expectedPosition } },
      () => {
        const entry = this.repository.getEntry(workId, entryId);
        if (!entry) throw new Error('条目不存在');
        if (entry.parentId !== input.expectedParentId || entry.position !== input.expectedPosition) {
          throw new EntryLocationConflictError(entry.parentId, entry.position);
        }
        if (parentId !== null) {
          const parent = this.repository.getEntry(workId, parentId);
          if (!parent || parent.kind !== 'directory' || parent.section !== entry.section) {
            throw new Error('目标目录不存在或不属于当前内容区域');
          }
          if (entry.kind === 'directory') {
            let ancestor: Entry | undefined = parent;
            while (ancestor) {
              if (ancestor.id === entryId) throw new Error('目录不能移入自身或子目录');
              ancestor = ancestor.parentId === null ? undefined : this.repository.getEntry(workId, ancestor.parentId);
            }
          }
        }
        const sameParent = entry.parentId === parentId;
        let position: number;
        if (beforeEntryId === null) {
          position = this.repository.nextPosition(workId, entry.section, parentId) - (sameParent ? 1 : 0);
        } else {
          const before = this.repository.getEntry(workId, beforeEntryId);
          if (!before || before.parentId !== parentId || before.section !== entry.section) {
            throw new Error('排序目标不存在或不属于目标目录');
          }
          position = before.position - (sameParent && entry.position < before.position ? 1 : 0);
        }
        if (sameParent && entry.position === position) return entry;
        this.repository.relocateEntry(workId, entry, parentId, position);
        return { ...entry, parentId, position };
      }
    );
  }

  listEntries(workId: string): Entry[] {
    return this.repository.listEntries(workId);
  }

  readDocument(workId: string, documentId: string): Document {
    const document = this.repository.getDocument(workId, documentId);
    if (!document) throw new Error('文稿或资料不存在');
    return document;
  }

  saveDocument(input: SaveDocumentInput): Entry {
    const result = this.commit(input.workId, input.commandId, saveParameters(input), { kind: 'entry' }, () => {
      const current = this.readDocument(input.workId, input.documentId);
      if (current.revisionId !== input.expectedRevisionId) {
        throw new RevisionConflictError(input.expectedRevisionId, current.revisionId);
      }
      const { content: currentContent, ...metadata } = current;
      if (metadata.title === input.title && metadata.format === input.format && currentContent === input.content)
        return metadata;
      const { content, ...saved } = {
        ...current,
        title: input.title,
        format: input.format,
        content: input.content,
        wordCount: countDocumentWords(input.content),
        revisionId: randomUUID(),
        updatedAt: Date.now()
      };
      const snapshot = { ...saved, content };
      this.repository.updateDocument(input.workId, snapshot, revisionFor(snapshot, current.revisionId));
      return saved;
    });
    this.repository.clearDraft(input.workId, input.documentId, input.commandId);
    return result;
  }

  readRevision(workId: string, revisionId: string): Revision {
    const revision = this.repository.getRevision(workId, revisionId);
    if (!revision) throw new Error('修订不存在');
    return revision;
  }

  writeDraft(input: WriteDraftInput): DraftState {
    this.assertDocument(input.workId, input.documentId);
    const entryId = this.repository.getRevisionEntryId(input.workId, input.expectedRevisionId);
    if (entryId === undefined) throw new Error('修订不存在');
    if (entryId !== input.documentId) throw new Error('恢复草稿的基线不属于当前文档');
    return writeDraft(this.repository, input);
  }

  readDraftState(workId: string, documentId: string): DraftState {
    this.assertDocument(workId, documentId);
    return this.repository.libraryTransaction(() => {
      const state = this.repository.getDraftState(workId, documentId);
      if (
        !state.draft ||
        this.repository.readWorkReceipt<Entry>(workId, state.draft.id, saveParameters(state.draft)) === undefined
      ) {
        return state;
      }
      this.repository.clearDraft(workId, documentId, state.draft.id);
      return { version: state.version, draft: null };
    });
  }

  discardDraft(workId: string, documentId: string, version: string): DraftState {
    this.assertDocument(workId, documentId);
    return discardDraft(this.repository, workId, documentId, version);
  }

  close(): void {
    this.listeners.clear();
    this.repository.close();
  }

  private assertDocument(workId: string, documentId: string): void {
    const entry = this.repository.getEntry(workId, documentId);
    if (!entry || entry.kind !== 'document') throw new Error('文稿或资料不存在');
  }
}

function saveParameters(input: Omit<SaveDocumentInput, 'commandId'>): readonly unknown[] {
  return [
    'saveDocument',
    input.workId,
    input.documentId,
    input.expectedRevisionId,
    input.title,
    input.format,
    input.content
  ];
}

function revisionFor(snapshot: Revision['snapshot'], parentRevisionId: string | null): Revision {
  return {
    id: snapshot.revisionId,
    entryId: snapshot.id,
    parentRevisionId,
    source: 'author',
    snapshot,
    createdAt: snapshot.updatedAt
  };
}
