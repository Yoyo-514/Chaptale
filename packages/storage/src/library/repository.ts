import type Database from 'better-sqlite3';

import type { LibraryRepository } from '@chaptale/creation';
import type {
  ReviewBatchIntent,
  ReviewIntent,
  ReviewResult,
  DraftState,
  PendingChange,
  RecoveryDraft,
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
    this.database
      .prepare(
        "DELETE FROM review_intents WHERE json_extract(input, '$.input.changeId') IN (SELECT id FROM pending_changes WHERE workId = ?)"
      )
      .run(workId);
    this.database
      .prepare("DELETE FROM review_batch_intents WHERE json_extract(input, '$.input.workId') = ?")
      .run(workId);
    this.database.prepare('DELETE FROM review_results WHERE workId = ?').run(workId);
    this.database.prepare('DELETE FROM pending_changes WHERE workId = ?').run(workId);
    this.database.prepare('DELETE FROM recovery_drafts WHERE workId = ?').run(workId);
    this.database.prepare('DELETE FROM session_selections WHERE scopeId = ?').run(workId);
    this.database.prepare('DELETE FROM work_trash WHERE workId = ?').run(workId);
    this.database.prepare('DELETE FROM works WHERE id = ?').run(workId);
  }

  readSessionState(): SessionState {
    return this.transaction(() => ({
      selections: this.database
        .prepare("SELECT nullif(scopeId, '') AS workId, sessionId FROM session_selections ORDER BY scopeId")
        .all() as SessionSelection[]
    }));
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
    const clear = this.database.prepare('UPDATE session_selections SET sessionId = NULL WHERE sessionId = ?');
    const results = this.database.prepare('DELETE FROM review_results WHERE sessionId = ?');
    for (const sessionId of sessionIds) {
      clear.run(sessionId);
      results.run(sessionId);
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

  putReviewResult(result: ReviewResult): void {
    this.database
      .prepare('INSERT OR IGNORE INTO review_results (id, workId, sessionId, value) VALUES (?, ?, ?, ?)')
      .run(result.id, result.workId, result.sessionId, JSON.stringify(result));
  }
  listReviewResults(sessionId: string): ReviewResult[] {
    const rows = this.database
      .prepare('SELECT value FROM review_results WHERE sessionId = ? AND reported = 0 ORDER BY sequence')
      .all(sessionId) as { value: string }[];
    return rows.map(row => JSON.parse(row.value) as ReviewResult);
  }
  reportReviewResults(sessionId: string, resultIds: string[]): void {
    this.transaction(() => {
      const update = this.database.prepare('UPDATE review_results SET reported = 1 WHERE sessionId = ? AND id = ?');
      for (const id of resultIds) update.run(sessionId, id);
    });
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
  putReviewIntent(input: ReviewIntent): void {
    reviews.putIntent(this.database, 'review_intents', input);
  }
  listReviewIntents(): ReviewIntent[] {
    return reviews.listIntents(this.database, 'review_intents');
  }
  clearReviewIntent(commandId: string): void {
    reviews.clearIntent(this.database, 'review_intents', commandId);
  }
  putReviewBatchIntent(input: ReviewBatchIntent): void {
    reviews.putIntent(this.database, 'review_batch_intents', input);
  }
  listReviewBatchIntents(): ReviewBatchIntent[] {
    return reviews.listIntents(this.database, 'review_batch_intents');
  }
  clearReviewBatchIntent(commandId: string): void {
    reviews.clearIntent(this.database, 'review_batch_intents', commandId);
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
