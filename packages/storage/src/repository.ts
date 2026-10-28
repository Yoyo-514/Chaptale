import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

import type { CommandCommit, CommitEffect, CommitResult, CreationRepository } from '@chaptale/creation';
import type {
  CreationChanges,
  CreationCursor,
  CreationSnapshot,
  DecideDeliveryInput,
  DecideReviewInput,
  DeliveryGroup,
  Document,
  DocumentSearchPage,
  DraftState,
  Entry,
  EntrySnapshot,
  PendingChange,
  RecoveryDraft,
  Revision,
  RevisionSummary,
  TrashBatch,
  TrashedWork,
  SearchDocumentsInput,
  SessionAssignment,
  SessionSelection,
  SessionState,
  Work,
  WorkbenchState
} from '@chaptale/creation/contracts';

import { commitCommand, readChanges, readCommandReceipt, readCursor } from './commands.ts';
import { entryFileDir, openLibrary, openWorkDatabase, workDir } from './database.ts';
import * as entries from './entries.ts';
import * as reviews from './reviews.ts';
import { searchDocuments } from './search.ts';
import * as trash from './trash.ts';

export async function openCreationStorage(options: { rootDir: string }): Promise<CreationRepository> {
  return new SqliteCreationRepository(options.rootDir, await openLibrary(options.rootDir));
}

class SqliteCreationRepository implements CreationRepository {
  private readonly rootDir: string;
  private readonly library: Database.Database;
  private work?: { id: string; database: Database.Database };

  constructor(rootDir: string, library: Database.Database) {
    this.rootDir = rootDir;
    this.library = library;
  }

  libraryTransaction<T>(apply: () => T): T {
    return this.library.transaction(apply)();
  }

  command<T extends CommitResult>(
    workId: string | null,
    commandId: string,
    parameters: readonly unknown[],
    effect: CommitEffect,
    apply: () => T
  ): CommandCommit<T> {
    const database = workId === null ? this.library : this.useWork(workId);
    return commitCommand(database, workId, commandId, parameters, effect, apply);
  }

  snapshot(workId: string | null): CreationSnapshot {
    const database = workId === null ? this.library : this.useWork(workId);
    return database.transaction((): CreationSnapshot => {
      const cursor = readCursor(database, workId);
      return workId === null
        ? { kind: 'library', cursor, works: this.listWorks() }
        : { kind: 'work', workId, cursor, entries: this.listEntries(workId) };
    })();
  }

  readChanges(cursor: CreationCursor, limit: number): CreationChanges {
    const database = cursor.workId === null ? this.library : this.useWork(cursor.workId);
    return readChanges(database, cursor, limit);
  }

  readWorkReceipt<T>(workId: string, commandId: string, parameters: readonly unknown[]): T | undefined {
    return readCommandReceipt<T>(this.useWork(workId), commandId, parameters);
  }

  hasWork(workId: string): boolean {
    return Boolean(
      this.library.prepare('SELECT 1 FROM works WHERE id = ? AND id NOT IN (SELECT workId FROM work_trash)').get(workId)
    );
  }

  readSessionState(): SessionState {
    return this.library.transaction(() => ({
      assignments: this.library
        .prepare('SELECT sessionId, workId FROM session_assignments ORDER BY sessionId')
        .all() as SessionAssignment[],
      selections: this.library
        .prepare("SELECT nullif(scopeId, '') AS workId, sessionId FROM session_selections ORDER BY scopeId")
        .all() as SessionSelection[]
    }))();
  }

  getSessionWork(sessionId: string): string | null {
    const row = this.library.prepare('SELECT workId FROM session_assignments WHERE sessionId = ?').get(sessionId) as
      | { workId: string }
      | undefined;
    return row?.workId ?? null;
  }

  assignSession(assignment: SessionAssignment): void {
    this.library
      .prepare('INSERT INTO session_assignments (sessionId, workId) VALUES (@sessionId, @workId)')
      .run(assignment);
    this.library
      .prepare("UPDATE session_selections SET sessionId = NULL WHERE scopeId = '' AND sessionId = ?")
      .run(assignment.sessionId);
  }

  selectSession({ workId, sessionId }: SessionSelection): void {
    // 空范围键表示独立会话；业务作品 ID 始终非空。
    this.library
      .prepare(
        'INSERT INTO session_selections (scopeId, sessionId) VALUES (?, ?) ON CONFLICT (scopeId) DO UPDATE SET sessionId = excluded.sessionId'
      )
      .run(workId ?? '', sessionId);
  }

  forgetSessions(sessionIds: string[]): void {
    const forget = this.library.prepare('DELETE FROM session_assignments WHERE sessionId = ?');
    const clear = this.library.prepare('UPDATE session_selections SET sessionId = NULL WHERE sessionId = ?');
    for (const sessionId of sessionIds) {
      forget.run(sessionId);
      clear.run(sessionId);
    }
  }

  readWorkbench(): WorkbenchState {
    const row = this.library.prepare('SELECT state FROM workbench_state WHERE id = 1').get() as
      | { state: string }
      | undefined;
    return row ? (JSON.parse(row.state) as WorkbenchState) : { activeWorkId: null, works: [] };
  }

  writeWorkbench(state: WorkbenchState): void {
    this.library
      .prepare(
        'INSERT INTO workbench_state (id, state) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state'
      )
      .run(JSON.stringify(state));
  }

  insertWork(work: Work): void {
    this.library
      .prepare(
        'INSERT INTO works (id, title, kind, createdAt, updatedAt) VALUES (@id, @title, @kind, @createdAt, @updatedAt)'
      )
      .run(work);
  }

  listWorks(): Work[] {
    const works = this.library
      .prepare(
        'SELECT id, title, kind, createdAt, updatedAt FROM works WHERE id NOT IN (SELECT workId FROM work_trash)'
      )
      .all() as Work[];
    for (const work of works) {
      const latest = this.useWork(work.id).prepare('SELECT max(updatedAt) AS updatedAt FROM entries').get() as {
        updatedAt: number | null;
      };
      work.updatedAt = Math.max(work.updatedAt, latest.updatedAt ?? work.createdAt);
    }
    // 本次查询独占的数组，按最近编辑排序。
    // oxlint-disable-next-line unicorn/no-array-sort
    return works.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  listTrashedWorks(): TrashedWork[] {
    return this.library
      .prepare(
        'SELECT w.id, w.title, w.kind, w.createdAt, w.updatedAt, t.deletedAt FROM works w JOIN work_trash t ON t.workId = w.id ORDER BY t.deletedAt DESC, w.id'
      )
      .all() as TrashedWork[];
  }

  getTrashedWork(workId: string): TrashedWork | undefined {
    return this.library
      .prepare(
        'SELECT w.id, w.title, w.kind, w.createdAt, w.updatedAt, t.deletedAt FROM works w JOIN work_trash t ON t.workId = w.id WHERE w.id = ?'
      )
      .get(workId) as TrashedWork | undefined;
  }

  trashWork(workId: string, now: number): void {
    this.library.prepare('INSERT INTO work_trash (workId, deletedAt) VALUES (?, ?)').run(workId, now);
  }

  restoreWork(workId: string): void {
    this.library.prepare('DELETE FROM work_trash WHERE workId = ?').run(workId);
  }

  purgeWork(workId: string): void {
    const changeIds = new Set(
      (this.library.prepare('SELECT id FROM pending_changes WHERE workId = ?').all(workId) as { id: string }[]).map(
        row => row.id
      )
    );
    const groups = this.library.prepare('SELECT id, value FROM delivery_groups').all() as {
      id: string;
      value: string;
    }[];
    const update = this.library.prepare('UPDATE delivery_groups SET value = ? WHERE id = ?');
    for (const row of groups) {
      const group = JSON.parse(row.value) as DeliveryGroup;
      if (!group.changeIds.some(id => changeIds.has(id))) continue;
      update.run(JSON.stringify({ ...group, changeIds: group.changeIds.filter(id => !changeIds.has(id)) }), row.id);
    }
    this.library.prepare('DELETE FROM pending_changes WHERE workId = ?').run(workId);
    this.library.prepare('DELETE FROM recovery_drafts WHERE workId = ?').run(workId);
    this.library.prepare('DELETE FROM session_assignments WHERE workId = ?').run(workId);
    this.library.prepare('DELETE FROM session_selections WHERE scopeId = ?').run(workId);
    this.library.prepare('DELETE FROM work_trash WHERE workId = ?').run(workId);
    this.library.prepare('DELETE FROM works WHERE id = ?').run(workId);
  }

  releaseWork(workId: string): string[] {
    if (this.work?.id === workId) {
      this.work.database.close();
      this.work = undefined;
    }
    const dir = workDir(this.rootDir, workId);
    return existsSync(dir) ? [dir] : [];
  }

  getEntry(workId: string, entryId: string): Entry | undefined {
    return entries.getEntry(this.useWork(workId), entryId);
  }
  nextPosition(workId: string, section: Entry['section'], parentId: string | null): number {
    return entries.nextPosition(this.useWork(workId), section, parentId);
  }
  insertEntry(workId: string, snapshot: Revision['snapshot'], revision: Revision): void {
    entries.insertEntry(this.useWork(workId), snapshot, revision);
  }
  updateDocument(workId: string, document: Document, revision: Revision): void {
    entries.updateDocument(this.useWork(workId), document, revision);
  }
  updateTitle(workId: string, snapshot: Revision['snapshot'], revision: Revision): void {
    entries.updateTitle(this.useWork(workId), snapshot, revision);
  }
  entryFileDir(workId: string, entryId: string): string {
    return entryFileDir(this.rootDir, workId, entryId);
  }
  relocateEntry(workId: string, entry: Entry, parentId: string | null, position: number): void {
    entries.relocateEntry(this.useWork(workId), entry, parentId, position);
  }
  listEntries(workId: string): Entry[] {
    return entries.listEntries(this.useWork(workId));
  }
  getDocument(workId: string, documentId: string): Document | undefined {
    return entries.getDocument(this.useWork(workId), documentId);
  }
  searchDocuments(
    input: SearchDocumentsInput,
    candidates?: readonly EntrySnapshot[],
    hidden?: readonly string[]
  ): DocumentSearchPage {
    return searchDocuments(this.useWork(input.workId), input, candidates, hidden);
  }
  getRevision(workId: string, revisionId: string): Revision | undefined {
    return entries.getRevision(this.useWork(workId), revisionId);
  }
  listRevisions(workId: string, entryId: string): RevisionSummary[] {
    return entries.listRevisions(this.useWork(workId), entryId);
  }
  getRevisionEntryId(workId: string, revisionId: string): string | undefined {
    return entries.getRevisionEntryId(this.useWork(workId), revisionId);
  }

  trashEntries(workId: string, rootIds: readonly string[], batchId: string, now: number): string[] {
    return trash.trashEntries(this.useWork(workId), rootIds, batchId, now);
  }
  listTrash(workId: string): TrashBatch[] {
    return trash.listTrash(this.useWork(workId));
  }
  isTrashed(workId: string, entryId: string): boolean {
    return trash.isTrashed(this.useWork(workId), entryId);
  }
  getTrashedDocument(workId: string, documentId: string): Document | undefined {
    return trash.getTrashedDocument(this.useWork(workId), documentId);
  }
  restoreTrash(workId: string, batchId: string): string[] {
    return trash.restoreBatch(this.useWork(workId), batchId);
  }
  purgeTrash(workId: string, batchId: string): Entry[] {
    return trash.purgeBatch(this.useWork(workId), batchId);
  }
  listTrashBatchIds(workId: string): string[] {
    return trash.listTrashBatchIds(this.useWork(workId));
  }
  clearDrafts(workId: string, documentIds: readonly string[]): void {
    const clear = this.library.prepare('DELETE FROM recovery_drafts WHERE workId = ? AND documentId = ?');
    this.library.transaction(() => {
      for (const id of documentIds) clear.run(workId, id);
    })();
  }

  getCurrentDelivery(sessionId: string): DeliveryGroup | undefined {
    const row = this.library
      .prepare('SELECT value FROM delivery_groups WHERE sessionId = ? ORDER BY sequence DESC LIMIT 1')
      .get(sessionId) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as DeliveryGroup) : undefined;
  }

  listDeliveryGroups(sessionId: string): DeliveryGroup[] {
    const rows = this.library
      .prepare('SELECT value FROM delivery_groups WHERE sessionId = ? ORDER BY sequence DESC')
      .all(sessionId) as { value: string }[];
    return rows.map(row => JSON.parse(row.value) as DeliveryGroup);
  }

  getDeliveryGroup(id: string): DeliveryGroup | undefined {
    const row = this.library.prepare('SELECT value FROM delivery_groups WHERE id = ?').get(id) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as DeliveryGroup) : undefined;
  }

  putDeliveryGroup(group: DeliveryGroup): void {
    this.library
      .prepare(
        'INSERT INTO delivery_groups (id, sessionId, value) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value'
      )
      .run(group.id, group.sessionId, JSON.stringify(group));
  }

  getPendingChange(id: string): PendingChange | undefined {
    return reviews.readPendingChange(this.library, id);
  }
  listPendingChanges(workId: string | null, sessionId: string | null): PendingChange[] {
    return reviews.listPendingChanges(this.library, workId, sessionId);
  }
  putPendingChange(change: PendingChange): void {
    reviews.putPendingChange(this.library, change);
  }
  putReviewIntent(input: DecideReviewInput): void {
    reviews.putIntent(this.library, 'review_intents', input);
  }
  listReviewIntents(): DecideReviewInput[] {
    return reviews.listIntents(this.library, 'review_intents');
  }
  clearReviewIntent(commandId: string): void {
    reviews.clearIntent(this.library, 'review_intents', commandId);
  }
  putDeliveryIntent(input: DecideDeliveryInput): void {
    reviews.putIntent(this.library, 'delivery_intents', input);
  }
  listDeliveryIntents(): DecideDeliveryInput[] {
    return reviews.listIntents(this.library, 'delivery_intents');
  }
  clearDeliveryIntent(commandId: string): void {
    reviews.clearIntent(this.library, 'delivery_intents', commandId);
  }

  getDraftState(workId: string, documentId: string): DraftState {
    const row = this.library
      .prepare('SELECT version, draft FROM recovery_drafts WHERE workId = ? AND documentId = ?')
      .get(workId, documentId) as { version: string; draft: string | null } | undefined;
    if (!row) return { version: null, draft: null };
    return { version: row.version, draft: row.draft === null ? null : (JSON.parse(row.draft) as RecoveryDraft) };
  }

  putDraft(draft: RecoveryDraft): void {
    this.library
      .prepare(`
      INSERT INTO recovery_drafts (workId, documentId, version, draft) VALUES (?, ?, ?, ?)
      ON CONFLICT (workId, documentId) DO UPDATE SET version = excluded.version, draft = excluded.draft
    `)
      .run(draft.workId, draft.documentId, draft.id, JSON.stringify(draft));
  }

  clearDraft(workId: string, documentId: string, draftId: string): void {
    // 保留版本身份以拒绝迟到写入；条件更新保护较新的草稿。
    this.library
      .prepare('UPDATE recovery_drafts SET draft = NULL WHERE workId = ? AND documentId = ? AND version = ?')
      .run(workId, documentId, draftId);
  }

  close(): void {
    this.work?.database.close();
    this.library.close();
  }

  private useWork(workId: string): Database.Database {
    if (this.work?.id === workId) return this.work.database;
    if (!this.library.prepare('SELECT id FROM works WHERE id = ?').get(workId)) throw new Error('作品不存在');
    const database = openWorkDatabase(this.rootDir, workId);
    this.work?.database.close();
    this.work = { id: workId, database };
    return database;
  }
}
