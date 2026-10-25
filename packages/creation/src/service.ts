import { randomUUID } from 'node:crypto';

import * as content from './content/mutations.ts';
import type {
  CreateEntryInput,
  CreateWorkInput,
  CreationChanges,
  CreationCursor,
  CreationEvent,
  CreationSnapshot,
  Document,
  DocumentSearchPage,
  SearchDocumentsInput,
  DraftState,
  Entry,
  MoveEntryInput,
  RenameDirectoryInput,
  Revision,
  SaveDocumentInput,
  SessionAssignment,
  SessionSelection,
  SessionState,
  Work,
  WorkbenchState,
  WriteDraftInput
} from './contracts.ts';
import * as drafts from './drafts.ts';
import type { CommitEffect, CommitResult, CreationRepository } from './repository.ts';
import * as sessions from './session-scopes.ts';

/** 作品用例的应用服务：协调事务、幂等回执和提交后的事件，领域规则归各自模块。 */
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

  commit<T extends CommitResult>(
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
  listEntries(workId: string): Entry[] {
    return this.repository.listEntries(workId);
  }
  readDocument(workId: string, documentId: string): Document {
    return content.readDocument(this.repository, workId, documentId);
  }
  searchDocuments(input: SearchDocumentsInput): DocumentSearchPage {
    return this.repository.searchDocuments(input);
  }

  createEntry(input: CreateEntryInput): Entry {
    return this.commit(
      input.workId,
      input.commandId,
      [
        'createEntry',
        input.workId,
        input.parentId,
        input.section,
        input.kind,
        input.title,
        input.kind === 'document' ? input.format : null,
        input.kind === 'document' ? input.content : null
      ],
      { kind: 'entry' },
      () => content.createEntry(this.repository, input)
    );
  }
  renameDirectory(input: RenameDirectoryInput): Entry {
    return this.commit(
      input.workId,
      input.commandId,
      ['renameDirectory', input.workId, input.directoryId, input.expectedRevisionId, input.title],
      { kind: 'entry' },
      () => content.renameDirectory(this.repository, input)
    );
  }
  moveEntry(input: MoveEntryInput): Entry {
    return this.commit(
      input.workId,
      input.commandId,
      [
        'moveEntry',
        input.workId,
        input.entryId,
        input.expectedParentId,
        input.expectedPosition,
        input.parentId,
        input.beforeEntryId
      ],
      { kind: 'move', from: { parentId: input.expectedParentId, position: input.expectedPosition } },
      () => content.moveEntry(this.repository, input)
    );
  }
  saveDocument(input: SaveDocumentInput): Entry {
    const saved = this.commit(input.workId, input.commandId, content.saveParameters(input), { kind: 'entry' }, () =>
      content.saveDocument(this.repository, input)
    );
    this.repository.clearDraft(input.workId, input.documentId, input.commandId);
    return saved;
  }
  readRevision(workId: string, revisionId: string): Revision {
    const revision = this.repository.getRevision(workId, revisionId);
    if (!revision) throw new Error('修订不存在');
    return revision;
  }

  readSessionState(): SessionState {
    return this.repository.readSessionState();
  }
  assignSession(input: SessionAssignment): SessionState {
    return sessions.assignSession(this.repository, input);
  }
  selectSession(input: SessionSelection): SessionState {
    return sessions.selectSession(this.repository, input);
  }
  readWorkbench(): WorkbenchState {
    return this.repository.readWorkbench();
  }
  writeWorkbench(state: WorkbenchState): WorkbenchState {
    this.repository.writeWorkbench(state);
    return state;
  }
  writeDraft(input: WriteDraftInput): DraftState {
    return drafts.writeDraft(this.repository, input);
  }
  readDraftState(workId: string, documentId: string): DraftState {
    return drafts.readDraftState(this.repository, workId, documentId);
  }
  discardDraft(workId: string, documentId: string, version: string): DraftState {
    return drafts.discardDraft(this.repository, workId, documentId, version);
  }
  close(): void {
    this.listeners.clear();
    this.repository.close();
  }
}
