import type Database from 'better-sqlite3';

import type { LibraryRepository } from '@chaptale/creation';
import type {
  DecideDeliveryInput,
  DecideReviewInput,
  DeliveryGroup,
  DraftState,
  PendingChange,
  RecoveryDraft,
  SessionAssignment,
  SessionSelection,
  SessionState,
  TrashedWork,
  Work,
  WorkbenchState
} from '@chaptale/creation/contracts';

import * as reviews from './reviews.ts';

/** 本机库 library.sqlite；作品更新时间由作品库条目派生，经 latestEntryUpdate 读取。 */
export class SqliteLibraryRepository implements LibraryRepository {
  private readonly database: Database.Database;
  private readonly latestEntryUpdate: (workId: string) => number | null;

  constructor(database: Database.Database, latestEntryUpdate: (workId: string) => number | null) {
    this.database = database;
    this.latestEntryUpdate = latestEntryUpdate;
  }

  transaction<T>(apply: () => T): T {
    return this.database.transaction(apply)();
  }

  hasWork(workId: string): boolean {
    return Boolean(
      this.database
        .prepare('SELECT 1 FROM works WHERE id = ? AND id NOT IN (SELECT workId FROM work_trash)')
        .get(workId)
    );
  }

  updateWork(work: Work): void {
    this.database
      .prepare('UPDATE works SET title = @title, kind = @kind, updatedAt = @updatedAt WHERE id = @id')
      .run(work);
  }

  insertWork(work: Work): void {
    this.database
      .prepare(
        'INSERT INTO works (id, title, kind, createdAt, updatedAt) VALUES (@id, @title, @kind, @createdAt, @updatedAt)'
      )
      .run(work);
  }

  listWorks(): Work[] {
    const works = this.database
      .prepare(
        'SELECT id, title, kind, createdAt, updatedAt FROM works WHERE id NOT IN (SELECT workId FROM work_trash)'
      )
      .all() as Work[];
    for (const work of works)
      work.updatedAt = Math.max(work.updatedAt, this.latestEntryUpdate(work.id) ?? work.createdAt);
    // 本次查询独占的数组，按最近编辑排序。
    // oxlint-disable-next-line unicorn/no-array-sort
    return works.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  listTrashedWorks(): TrashedWork[] {
    return this.database
      .prepare(
        'SELECT w.id, w.title, w.kind, w.createdAt, w.updatedAt, t.deletedAt FROM works w JOIN work_trash t ON t.workId = w.id ORDER BY t.deletedAt DESC, w.id'
      )
      .all() as TrashedWork[];
  }

  getTrashedWork(workId: string): TrashedWork | undefined {
    return this.database
      .prepare(
        'SELECT w.id, w.title, w.kind, w.createdAt, w.updatedAt, t.deletedAt FROM works w JOIN work_trash t ON t.workId = w.id WHERE w.id = ?'
      )
      .get(workId) as TrashedWork | undefined;
  }

  trashWork(workId: string, now: number): void {
    this.database.prepare('INSERT INTO work_trash (workId, deletedAt) VALUES (?, ?)').run(workId, now);
  }

  restoreWork(workId: string): void {
    this.database.prepare('DELETE FROM work_trash WHERE workId = ?').run(workId);
  }

  purgeWork(workId: string): void {
    const changeIds = new Set(
      (this.database.prepare('SELECT id FROM pending_changes WHERE workId = ?').all(workId) as { id: string }[]).map(
        row => row.id
      )
    );
    const groups = this.database.prepare('SELECT id, value FROM delivery_groups').all() as {
      id: string;
      value: string;
    }[];
    const update = this.database.prepare('UPDATE delivery_groups SET value = ? WHERE id = ?');
    for (const row of groups) {
      const group = JSON.parse(row.value) as DeliveryGroup;
      if (!group.changeIds.some(id => changeIds.has(id))) continue;
      update.run(JSON.stringify({ ...group, changeIds: group.changeIds.filter(id => !changeIds.has(id)) }), row.id);
    }
    this.database.prepare('DELETE FROM pending_changes WHERE workId = ?').run(workId);
    this.database.prepare('DELETE FROM recovery_drafts WHERE workId = ?').run(workId);
    this.database.prepare('DELETE FROM session_assignments WHERE workId = ?').run(workId);
    this.database.prepare('DELETE FROM session_selections WHERE scopeId = ?').run(workId);
    this.database.prepare('DELETE FROM work_trash WHERE workId = ?').run(workId);
    this.database.prepare('DELETE FROM works WHERE id = ?').run(workId);
  }

  readSessionState(): SessionState {
    return this.transaction(() => ({
      assignments: this.database
        .prepare('SELECT sessionId, workId FROM session_assignments ORDER BY sessionId')
        .all() as SessionAssignment[],
      selections: this.database
        .prepare("SELECT nullif(scopeId, '') AS workId, sessionId FROM session_selections ORDER BY scopeId")
        .all() as SessionSelection[]
    }));
  }

  getSessionWork(sessionId: string): string | null {
    const row = this.database.prepare('SELECT workId FROM session_assignments WHERE sessionId = ?').get(sessionId) as
      | { workId: string }
      | undefined;
    return row?.workId ?? null;
  }

  assignSession(assignment: SessionAssignment): void {
    this.database
      .prepare('INSERT INTO session_assignments (sessionId, workId) VALUES (@sessionId, @workId)')
      .run(assignment);
    this.database
      .prepare("UPDATE session_selections SET sessionId = NULL WHERE scopeId = '' AND sessionId = ?")
      .run(assignment.sessionId);
  }

  selectSession({ workId, sessionId }: SessionSelection): void {
    // 空范围键表示独立会话；业务作品 ID 始终非空。
    this.database
      .prepare(
        'INSERT INTO session_selections (scopeId, sessionId) VALUES (?, ?) ON CONFLICT (scopeId) DO UPDATE SET sessionId = excluded.sessionId'
      )
      .run(workId ?? '', sessionId);
  }

  forgetSessions(sessionIds: string[]): void {
    const forget = this.database.prepare('DELETE FROM session_assignments WHERE sessionId = ?');
    const clear = this.database.prepare('UPDATE session_selections SET sessionId = NULL WHERE sessionId = ?');
    for (const sessionId of sessionIds) {
      forget.run(sessionId);
      clear.run(sessionId);
    }
  }

  readWorkbench(): WorkbenchState {
    const row = this.database.prepare('SELECT state FROM workbench_state WHERE id = 1').get() as
      | { state: string }
      | undefined;
    return row ? (JSON.parse(row.state) as WorkbenchState) : { activeWorkId: null, works: [] };
  }

  writeWorkbench(state: WorkbenchState): void {
    this.database
      .prepare(
        'INSERT INTO workbench_state (id, state) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state'
      )
      .run(JSON.stringify(state));
  }

  getCurrentDelivery(sessionId: string): DeliveryGroup | undefined {
    const row = this.database
      .prepare('SELECT value FROM delivery_groups WHERE sessionId = ? ORDER BY sequence DESC LIMIT 1')
      .get(sessionId) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as DeliveryGroup) : undefined;
  }

  listDeliveryGroups(sessionId: string): DeliveryGroup[] {
    const rows = this.database
      .prepare('SELECT value FROM delivery_groups WHERE sessionId = ? ORDER BY sequence DESC')
      .all(sessionId) as { value: string }[];
    return rows.map(row => JSON.parse(row.value) as DeliveryGroup);
  }

  getDeliveryGroup(id: string): DeliveryGroup | undefined {
    const row = this.database.prepare('SELECT value FROM delivery_groups WHERE id = ?').get(id) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as DeliveryGroup) : undefined;
  }

  putDeliveryGroup(group: DeliveryGroup): void {
    this.database
      .prepare(
        'INSERT INTO delivery_groups (id, sessionId, value) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value'
      )
      .run(group.id, group.sessionId, JSON.stringify(group));
  }

  getPendingChange(id: string): PendingChange | undefined {
    return reviews.readPendingChange(this.database, id);
  }
  listPendingChanges(workId: string | null, sessionId: string | null): PendingChange[] {
    return reviews.listPendingChanges(this.database, workId, sessionId);
  }
  putPendingChange(change: PendingChange): void {
    reviews.putPendingChange(this.database, change);
  }
  putReviewIntent(input: DecideReviewInput): void {
    reviews.putIntent(this.database, 'review_intents', input);
  }
  listReviewIntents(): DecideReviewInput[] {
    return reviews.listIntents(this.database, 'review_intents');
  }
  clearReviewIntent(commandId: string): void {
    reviews.clearIntent(this.database, 'review_intents', commandId);
  }
  putDeliveryIntent(input: DecideDeliveryInput): void {
    reviews.putIntent(this.database, 'delivery_intents', input);
  }
  listDeliveryIntents(): DecideDeliveryInput[] {
    return reviews.listIntents(this.database, 'delivery_intents');
  }
  clearDeliveryIntent(commandId: string): void {
    reviews.clearIntent(this.database, 'delivery_intents', commandId);
  }

  getDraftState(workId: string, documentId: string): DraftState {
    const row = this.database
      .prepare('SELECT version, draft FROM recovery_drafts WHERE workId = ? AND documentId = ?')
      .get(workId, documentId) as { version: string; draft: string | null } | undefined;
    if (!row) return { version: null, draft: null };
    return { version: row.version, draft: row.draft === null ? null : (JSON.parse(row.draft) as RecoveryDraft) };
  }

  putDraft(draft: RecoveryDraft): void {
    this.database
      .prepare(`
      INSERT INTO recovery_drafts (workId, documentId, version, draft) VALUES (?, ?, ?, ?)
      ON CONFLICT (workId, documentId) DO UPDATE SET version = excluded.version, draft = excluded.draft
    `)
      .run(draft.workId, draft.documentId, draft.id, JSON.stringify(draft));
  }

  clearDraft(workId: string, documentId: string, draftId: string): void {
    // 保留版本身份以拒绝迟到写入；条件更新保护较新的草稿。
    this.database
      .prepare('UPDATE recovery_drafts SET draft = NULL WHERE workId = ? AND documentId = ? AND version = ?')
      .run(workId, documentId, draftId);
  }

  clearDrafts(workId: string, documentIds: readonly string[]): void {
    const clear = this.database.prepare('DELETE FROM recovery_drafts WHERE workId = ? AND documentId = ?');
    this.transaction(() => {
      for (const id of documentIds) clear.run(workId, id);
    });
  }
}
