import type {
  ReviewBatchIntent,
  ReviewIntent,
  ReviewResult,
  CreationChanges,
  CreationCursor,
  CreationEvent,
  CreationSnapshot,
  Document,
  DraftState,
  Entry,
  EntrySnapshot,
  RecoveryDraft,
  PendingChange,
  RecordSnapshot,
  RelationSnapshot,
  StoryRelation,
  SessionSelection,
  SessionState,
  Revision,
  StoryRecord,
  RevisionSummary,
  TrashBatch,
  TrashedWork,
  Work,
  WorkbenchState,
  WorkSnapshot
} from './contracts/index.ts';

/** 回执中的事件描述复用结果元数据，避免重复保存条目。 */
export type CommitEffect =
  | { kind: 'work' }
  | { kind: 'library' }
  | { kind: 'writingGuidelines' }
  | { kind: 'entry' }
  | { kind: 'entries' }
  | { kind: 'review' }
  | { kind: 'reviewBatch'; sessionId: string }
  | { kind: 'record'; removed: boolean }
  | { kind: 'records' }
  | { kind: 'relation'; removed: boolean }
  | { kind: 'move'; from: { parentId: string | null; position: number } };

export type CommitResult =
  | Work
  | { writingGuidelines: string }
  | Entry
  | Entry[]
  | PendingChange
  | { sessionId: string; count: number }
  | StoryRecord
  | StoryRelation
  | { count: number };

/** 一并参与检索的事件或关系；涉及资料的标题与别名也能搜到它。 */
export interface SearchNote {
  kind: 'record' | 'relation';
  id: string;
  resourceIds: readonly string[];
  text: string;
}

/** 向量索引对应的 embedding 模型；dimensions 为 null 时用模型的默认维度。 */
export interface VectorIndexTarget {
  model: string;
  dimensions: number | null;
}

export interface StoredVector {
  hash: string;
  vector: Float32Array;
}

/** 关键词检索的范围：正式条目索引，加上覆盖正式正文的 candidates 和 notes，去掉 hidden 中的条目。 */
export interface WorkSearchQuery {
  query: string;
  section?: Entry['section'];
  offset: number;
  limit: number;
  candidates: readonly EntrySnapshot[];
  hidden: readonly string[];
  notes: readonly SearchNote[];
}

/** 按相关度排列的命中；terms 为查询切出的词，供挑选命中段落。 */
export interface WorkSearchMatches {
  terms: string[];
  matches: { kind: 'entry' | SearchNote['kind']; id: string }[];
  hasMore: boolean;
}

/** 事件的一次修订；顺序不进入修订。 */
export interface RecordRevision {
  id: string;
  recordId: string;
  parentRevisionId: string | null;
  source: Revision['source'];
  snapshot: RecordSnapshot;
  createdAt: number;
}

/** 关系的一次修订，保存连同建立／结束的整份快照。 */
export interface RelationRevision {
  id: string;
  relationId: string;
  parentRevisionId: string | null;
  source: Revision['source'];
  snapshot: RelationSnapshot;
  createdAt: number;
}

export interface CommandCommit<T> {
  result: T;
  event: CreationEvent;
  fresh: boolean;
}

/** 本机库 library.sqlite：作品列表、会话归属、工作台、待审修改、处理结果、提交意图与恢复草稿。 */
export interface LibraryRepository {
  /** 回调同步执行，内部读写共用本机库事务。 */
  transaction<T>(apply: () => T): T;

  /** 正常作品库中的作品；回收站中的作品不算。 */
  hasWork(workId: string): boolean;
  insertWork(work: Work): void;
  /** 覆盖导入时换上作品包里的标题与类型。 */
  updateWork(work: Work): void;
  listWorks(): Work[];
  listTrashedWorks(): TrashedWork[];
  getTrashedWork(workId: string): TrashedWork | undefined;
  trashWork(workId: string, now: number): void;
  restoreWork(workId: string): void;
  /** 删除作品库中该作品的记录与查看位置，清除对应审阅进度。 */
  purgeWork(workId: string): void;

  readSessionState(): SessionState;
  selectSession(selection: SessionSelection): void;
  forgetSessions(sessionIds: string[]): void;
  readWorkbench(): WorkbenchState;
  writeWorkbench(state: WorkbenchState): void;

  putReviewResult(result: ReviewResult): void;
  listReviewResults(sessionId: string): ReviewResult[];
  reportReviewResults(sessionId: string, resultIds: string[]): void;

  getPendingChange(id: string): PendingChange | undefined;
  listPendingChanges(workId: string | null, sessionId: string | null): PendingChange[];
  putPendingChange(change: PendingChange): void;
  putReviewIntent(intent: ReviewIntent): void;
  listReviewIntents(): ReviewIntent[];
  clearReviewIntent(commandId: string): void;
  putReviewBatchIntent(intent: ReviewBatchIntent): void;
  listReviewBatchIntents(): ReviewBatchIntent[];
  clearReviewBatchIntent(commandId: string): void;

  getDraftState(workId: string, documentId: string): DraftState;
  putDraft(draft: RecoveryDraft): void;
  clearDraft(workId: string, documentId: string, draftId: string): void;
  clearDrafts(workId: string, documentIds: readonly string[]): void;
}

/** 一部作品的 work.sqlite：正式条目、修订、检索、回收站与命令回执。 */
export interface WorkRepository {
  readonly workId: string;
  readReceipt<T>(commandId: string, parameters: readonly unknown[]): T | undefined;
  readWritingGuidelines(): string;
  writeWritingGuidelines(writingGuidelines: string, now: number): void;

  getEntry(entryId: string): Entry | undefined;
  listEntries(): Entry[];
  nextPosition(section: Entry['section'], parentId: string | null): number;
  insertEntry(snapshot: Revision['snapshot'], revision: Revision): void;
  updateDocument(document: Document, revision: Revision): void;
  /** 目录与文件条目改名。 */
  updateTitle(snapshot: Revision['snapshot'], revision: Revision): void;
  relocateEntry(entry: Entry, parentId: string | null, position: number): void;
  getDocument(documentId: string): Document | undefined;
  /** 资料区文件条目所在的作品文件目录，可能尚未创建。 */
  filesDir(): string;
  /** 文件条目独占的目录，存放添加时复制的文件。 */
  entryFileDir(entryId: string): string;
  searchWork(query: WorkSearchQuery): WorkSearchMatches;
  /** 向量索引用的模型；作者还没为这部作品启动过建立时为 undefined。 */
  vectorTarget(): VectorIndexTarget | undefined;
  startVectorIndex(target: VectorIndexTarget): void;
  /** 已有向量的文字。 */
  vectorHashes(): Set<string>;
  /** 向量长度须与索引里已有的一致。 */
  saveVectors(vectors: readonly StoredVector[]): void;
  /** 索引里每段文字的向量与 question 的余弦相似度；question 的长度须与索引里的向量一致。 */
  vectorScores(question: Float32Array): Map<string, number>;
  /** 删除整个向量索引，作品回到没有启动过的状态。 */
  clearVectorIndex(): void;
  getRevision(revisionId: string): Revision | undefined;
  /** 正文与前一修订不同的修订，最新在前。 */
  listRevisions(entryId: string): RevisionSummary[];
  getRevisionEntryId(revisionId: string): string | undefined;

  /** 条目及其正常子项记为同一删除批次，返回进入回收站的全部条目 ID。 */
  trashEntries(rootIds: readonly string[], batchId: string, now: number): string[];
  listTrash(): TrashBatch[];
  isTrashed(entryId: string): boolean;
  getTrashedDocument(documentId: string): Document | undefined;
  getTrashedEntry(entryId: string): Entry | undefined;
  /** 返回恢复到正常目录的条目 ID。 */
  restoreTrash(batchId: string): string[];
  /** 返回被永久删除条目的元数据。 */
  purgeTrash(batchId: string): Entry[];
  listTrashBatchIds(): string[];

  /** 不在回收站中的事件，按发生位置与顺序排列。 */
  listRecords(): StoryRecord[];
  getRecord(recordId: string): StoryRecord | undefined;
  /**
   * 写入事件的新修订。新事件或发生位置改变时排到新位置末尾，原位置的后续事件前移；返回写入后的事件。
   */
  saveRecord(snapshot: RecordSnapshot, revision: RecordRevision): StoryRecord;
  /** 插到 beforeId 之前，beforeId 为 null 时排到末尾；两者须在同一发生位置。 */
  moveRecord(recordId: string, beforeId: string | null): StoryRecord;
  /** 单个事件移入回收站，自成一个删除批次。 */
  trashRecord(recordId: string, batchId: string, now: number): void;
  isRecordTrashed(recordId: string): boolean;

  /** 不在回收站中的关系。 */
  listRelations(): StoryRelation[];
  getRelation(relationId: string): StoryRelation | undefined;
  /** 写入关系的新修订，建立／结束按快照整体替换；返回写入后的关系。 */
  saveRelation(snapshot: RelationSnapshot, revision: RelationRevision): StoryRelation;
  /** 单条关系移入回收站，自成一个删除批次。 */
  trashRelation(relationId: string, batchId: string, now: number): void;
  isRelationTrashed(relationId: string): boolean;
  /** 建立／结束随出处章节进入回收站；关系保存时不再列出它们。 */
  trashMilestones(milestoneIds: readonly string[], batchId: string, now: number): void;
  hasTrashedStart(relationId: string): boolean;
}

/**
 * 业务所需的持久化操作，按数据库分为本机库与作品库；两库各自提交，跨库顺序由应用服务凭回执协调。
 * command 的回调同步执行，修改与回执共用对应数据库事务。
 */
export interface CreationRepository {
  readonly library: LibraryRepository;
  work(workId: string): WorkRepository;
  command<T extends CommitResult>(
    workId: string | null,
    commandId: string,
    parameters: readonly unknown[],
    effect: CommitEffect,
    apply: () => T
  ): CommandCommit<T>;
  snapshot(workId: string | null): CreationSnapshot;
  readChanges(cursor: CreationCursor, limit: number): CreationChanges;
  /** 关闭作品数据库连接，返回仍存在的作品目录及其导入前快照。 */
  releaseWork(workId: string): string[];
  /** 把作品库快照与资料文件写成作品包。 */
  exportWorkPackage(workId: string, file: string): void;
  /** 读取作品包里的作品信息；不是作品包或版本过新时报错。 */
  readWorkPackage(file: string): Work;
  /** 在作品目录旁展开作品包并升级结构。 */
  stageWorkPackage(file: string, workId: string): void;
  discardStagedWork(workId: string): void;
  /** 换上已展开的作品包；previous 不为空时原目录留作导入前快照。返回撤销函数。 */
  installStagedWork(workId: string, previous: Work | null): () => void;
  /** 只保留最新一份导入前快照，返回较早的快照目录。 */
  pruneWorkSnapshots(workId: string): string[];
  listWorkSnapshots(): WorkSnapshot[];
  /** 最新导入前快照记录的作品信息。 */
  readWorkSnapshot(workId: string): Work;
  /** 换回最新导入前快照；replaced 为换下的目录。 */
  restoreWorkSnapshot(workId: string): { replaced: string; undo: () => void };
  close(): void;
}
