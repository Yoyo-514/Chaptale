import type Database from 'better-sqlite3';

import type {
  RecordRevision,
  RelationRevision,
  WorkRepository,
  WorkSearchMatches,
  WorkSearchQuery,
  StoredVector,
  VectorIndexTarget
} from '@chaptale/creation';
import type {
  Document,
  Entry,
  RecordSnapshot,
  RelationSnapshot,
  StoryRelation,
  StoryRecord,
  Revision,
  RevisionSummary,
  TrashBatch
} from '@chaptale/creation/contracts';

import { readCommandReceipt } from '../commands.ts';
import { entryFileDir, workFilesDir } from './database.ts';
import * as entries from './entries.ts';
import * as records from './records.ts';
import * as relations from './relations.ts';
import { searchWork } from './search.ts';
import * as trash from './trash.ts';
import * as vectors from './vectors.ts';

/** 一部作品的 work.sqlite；连接由组装入口按需打开，每次读写时取用。 */
export class SqliteWorkRepository implements WorkRepository {
  readonly workId: string;
  private readonly rootDir: string;
  private readonly connect: () => Database.Database;

  constructor(rootDir: string, workId: string, connect: () => Database.Database) {
    this.rootDir = rootDir;
    this.workId = workId;
    this.connect = connect;
  }

  readReceipt<T>(commandId: string, parameters: readonly unknown[]): T | undefined {
    return readCommandReceipt<T>(this.connect(), commandId, parameters);
  }

  readWritingGuidelines(): string {
    const row = this.connect().prepare('SELECT writingGuidelines FROM work_settings WHERE id = 1').get() as
      | { writingGuidelines: string }
      | undefined;
    return row?.writingGuidelines ?? '';
  }

  writeWritingGuidelines(writingGuidelines: string, now: number): void {
    this.connect()
      .prepare(
        `INSERT INTO work_settings (id, writingGuidelines, updatedAt)
         VALUES (1, @writingGuidelines, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET writingGuidelines = excluded.writingGuidelines, updatedAt = excluded.updatedAt`
      )
      .run({ writingGuidelines, updatedAt: now });
  }

  getEntry(entryId: string): Entry | undefined {
    return entries.getEntry(this.connect(), entryId);
  }
  listEntries(): Entry[] {
    return entries.listEntries(this.connect());
  }
  nextPosition(section: Entry['section'], parentId: string | null): number {
    return entries.nextPosition(this.connect(), section, parentId);
  }
  insertEntry(snapshot: Revision['snapshot'], revision: Revision): void {
    entries.insertEntry(this.connect(), snapshot, revision);
  }
  updateDocument(document: Document, revision: Revision): void {
    entries.updateDocument(this.connect(), document, revision);
  }
  updateTitle(snapshot: Revision['snapshot'], revision: Revision): void {
    entries.updateTitle(this.connect(), snapshot, revision);
  }
  relocateEntry(entry: Entry, parentId: string | null, position: number): void {
    entries.relocateEntry(this.connect(), entry, parentId, position);
  }
  getDocument(documentId: string): Document | undefined {
    return entries.getDocument(this.connect(), documentId);
  }
  filesDir(): string {
    return workFilesDir(this.rootDir, this.workId);
  }
  entryFileDir(entryId: string): string {
    return entryFileDir(this.rootDir, this.workId, entryId);
  }
  searchWork(query: WorkSearchQuery): WorkSearchMatches {
    return searchWork(this.connect(), query);
  }
  vectorTarget(): VectorIndexTarget | undefined {
    return vectors.readVectorTarget(this.rootDir, this.workId);
  }
  startVectorIndex(target: VectorIndexTarget): void {
    // 先取作品库连接：确认作品存在，作品目录也随之建好。
    this.connect();
    vectors.startVectorIndex(this.rootDir, this.workId, target);
  }
  vectorHashes(): Set<string> {
    return vectors.readVectorHashes(this.rootDir, this.workId);
  }
  saveVectors(stored: readonly StoredVector[]): void {
    vectors.saveVectors(this.rootDir, this.workId, stored);
  }
  clearVectorIndex(): void {
    vectors.clearVectorIndex(this.rootDir, this.workId);
  }
  getRevision(revisionId: string): Revision | undefined {
    return entries.getRevision(this.connect(), revisionId);
  }
  listRevisions(entryId: string): RevisionSummary[] {
    return entries.listRevisions(this.connect(), entryId);
  }
  getRevisionEntryId(revisionId: string): string | undefined {
    return entries.getRevisionEntryId(this.connect(), revisionId);
  }

  trashEntries(rootIds: readonly string[], batchId: string, now: number): string[] {
    return trash.trashEntries(this.connect(), rootIds, batchId, now);
  }
  listTrash(): TrashBatch[] {
    return trash.listTrash(this.connect());
  }
  isTrashed(entryId: string): boolean {
    return trash.isTrashed(this.connect(), entryId);
  }
  getTrashedEntry(entryId: string): Entry | undefined {
    return entries.getTrashedEntry(this.connect(), entryId);
  }
  getTrashedDocument(documentId: string): Document | undefined {
    return trash.getTrashedDocument(this.connect(), documentId);
  }
  restoreTrash(batchId: string): string[] {
    return trash.restoreBatch(this.connect(), batchId);
  }
  purgeTrash(batchId: string): Entry[] {
    return trash.purgeBatch(this.connect(), batchId);
  }
  listTrashBatchIds(): string[] {
    return trash.listTrashBatchIds(this.connect());
  }

  listRecords(): StoryRecord[] {
    return records.listRecords(this.connect());
  }
  getRecord(recordId: string): StoryRecord | undefined {
    return records.getRecord(this.connect(), recordId);
  }
  saveRecord(snapshot: RecordSnapshot, revision: RecordRevision): StoryRecord {
    return records.saveRecord(this.connect(), snapshot, revision);
  }
  moveRecord(recordId: string, beforeId: string | null): StoryRecord {
    return records.moveRecord(this.connect(), recordId, beforeId);
  }
  trashRecord(recordId: string, batchId: string, now: number): void {
    records.trashRecord(this.connect(), recordId, batchId, now);
  }
  isRecordTrashed(recordId: string): boolean {
    return records.isRecordTrashed(this.connect(), recordId);
  }

  listRelations(): StoryRelation[] {
    return relations.listRelations(this.connect());
  }
  getRelation(relationId: string): StoryRelation | undefined {
    return relations.getRelation(this.connect(), relationId);
  }
  saveRelation(snapshot: RelationSnapshot, revision: RelationRevision): StoryRelation {
    return relations.saveRelation(this.connect(), snapshot, revision);
  }
  trashRelation(relationId: string, batchId: string, now: number): void {
    relations.trashRelation(this.connect(), relationId, batchId, now);
  }
  trashMilestones(milestoneIds: readonly string[], batchId: string, now: number): void {
    relations.trashMilestones(this.connect(), milestoneIds, batchId, now);
  }
  hasTrashedStart(relationId: string): boolean {
    return relations.hasTrashedStart(this.connect(), relationId);
  }
  isRelationTrashed(relationId: string): boolean {
    return relations.isRelationTrashed(this.connect(), relationId);
  }
}
