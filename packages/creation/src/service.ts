import { randomUUID } from 'node:crypto';

import { applySnapshot, snapshotEffect, type SnapshotCommit } from './content/commit.ts';
import * as drafts from './content/drafts.ts';
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
  RenameEntryInput,
  Revision,
  RevisionSummary,
  SaveDocumentInput,
  SessionAssignment,
  SessionSelection,
  SessionState,
  Work,
  WorkbenchState,
  WriteDraftInput
} from './contracts.ts';
import { assertNotTrashed } from './errors.ts';
import * as sessions from './library/sessions.ts';
import type { CommitEffect, CommitResult, CreationRepository } from './repository.ts';

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

  /** 提交一份正式内容快照；改变目录位置时回执记录原位置。 */
  commitSnapshot(input: SnapshotCommit): Entry {
    return this.commit(
      input.workId,
      input.commandId,
      input.parameters,
      snapshotEffect(input.base, input.candidate),
      () => applySnapshot(this.repository.work(input.workId), input)
    );
  }

  createWork(input: CreateWorkInput): Work {
    return this.commit(null, input.commandId, ['createWork', input.title, input.kind], { kind: 'work' }, () => {
      const now = Date.now();
      const work: Work = { id: randomUUID(), title: input.title, kind: input.kind, createdAt: now, updatedAt: now };
      this.repository.library.insertWork(work);
      return work;
    });
  }
  listWorks(): Work[] {
    return this.repository.library.listWorks();
  }
  listEntries(workId: string): Entry[] {
    return this.repository.work(workId).listEntries();
  }
  readDocument(workId: string, documentId: string): Document {
    return content.readDocument(this.repository.work(workId), documentId);
  }
  searchDocuments(input: SearchDocumentsInput): DocumentSearchPage {
    return this.repository.work(input.workId).searchDocuments(input);
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
      () => content.createEntry(this.repository.work(input.workId), input)
    );
  }
  renameEntry(input: RenameEntryInput): Entry {
    return this.commit(
      input.workId,
      input.commandId,
      ['renameEntry', input.workId, input.entryId, input.expectedRevisionId, input.title],
      { kind: 'entry' },
      () => content.renameEntry(this.repository.work(input.workId), input)
    );
  }
  /** 文件已复制到 entryFileDir 后登记；同一命令重试返回首次登记的条目。 */
  addFileEntry(input: {
    commandId: string;
    workId: string;
    parentId: string | null;
    entryId: string;
    fileName: string;
  }): Entry {
    return this.commit(
      input.workId,
      input.commandId,
      ['addFile', input.workId, input.parentId, input.fileName],
      { kind: 'entry' },
      () => content.insertFileEntry(this.repository.work(input.workId), input)
    );
  }
  entryFileDir(workId: string, entryId: string): string {
    return this.repository.work(workId).entryFileDir(entryId);
  }
  /** 文件条目；trashed 为 true 时只读回收站中的条目（供回收站预览），否则回收站中的条目返回“条目在回收站中”。 */
  readFileEntry(workId: string, entryId: string, trashed: boolean): Entry {
    const work = this.repository.work(workId);
    const entry = trashed ? work.getTrashedEntry(entryId) : work.getEntry(entryId);
    if (!entry && !trashed) assertNotTrashed(work, entryId);
    if (entry?.kind !== 'file') throw new Error('文件条目不存在');
    return entry;
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
      () => content.moveEntry(this.repository.work(input.workId), input)
    );
  }
  saveDocument(input: SaveDocumentInput): Entry {
    const saved = this.commit(input.workId, input.commandId, content.saveParameters(input), { kind: 'entry' }, () =>
      content.saveDocument(this.repository.work(input.workId), input)
    );
    this.repository.library.clearDraft(input.workId, input.documentId, input.commandId);
    return saved;
  }
  listRevisions(workId: string, documentId: string): RevisionSummary[] {
    content.readDocument(this.repository.work(workId), documentId);
    return this.repository.work(workId).listRevisions(documentId);
  }
  readRevision(workId: string, revisionId: string): Revision {
    const revision = this.repository.work(workId).getRevision(revisionId);
    if (!revision) throw new Error('修订不存在');
    return revision;
  }

  readSessionState(): SessionState {
    return this.repository.library.readSessionState();
  }
  assignSession(input: SessionAssignment): SessionState {
    return sessions.assignSession(this.repository.library, input);
  }
  selectSession(input: SessionSelection): SessionState {
    return sessions.selectSession(this.repository.library, input);
  }
  forgetSessions(sessionIds: string[]): SessionState {
    return this.repository.library.transaction(() => {
      this.repository.library.forgetSessions(sessionIds);
      return this.repository.library.readSessionState();
    });
  }
  readWorkbench(): WorkbenchState {
    return this.repository.library.readWorkbench();
  }
  writeWorkbench(state: WorkbenchState): WorkbenchState {
    this.repository.library.writeWorkbench(state);
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
