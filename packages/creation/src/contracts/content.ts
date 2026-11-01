/** 作品领域的纯数据契约，不依赖 Node、SQLite、Electron 与 pi。 */
export interface Work {
  id: string;
  title: string;
  kind: 'novel' | 'script';
  createdAt: number;
  updatedAt: number;
}

export interface Entry {
  id: string;
  parentId: string | null;
  section: 'manuscript' | 'resource';
  /** 文件条目只在资料区，保存作者添加的参考文件。 */
  kind: 'directory' | 'document' | 'file';
  title: string;
  position: number;
  format: 'txt' | 'markdown' | null;
  /** 文件条目在作品目录中的文件名，添加时取原文件名，改名不变；其他条目为 null。 */
  fileName: string | null;
  wordCount: number;
  revisionId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Document extends Entry {
  kind: 'document';
  format: 'txt' | 'markdown';
  content: string;
  /** 只有资料有属性；文稿为 null。 */
  attributes: ResourceAttributes | null;
}

/** 类型和标签用于筛选与可视化，空串表示未设置类型；别名进入检索；封面为资料区图片文件条目的 ID。 */
export interface ResourceAttributes {
  type: string;
  aliases: string[];
  tags: string[];
  cover: string | null;
}

/** 应用内可预览、可作封面的图片格式，与 pi 读取工具支持的格式一致。 */
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
export function isImageFile(entry: Pick<Entry, 'kind' | 'fileName'>): boolean {
  return entry.kind === 'file' && imageExtensions.has(entry.fileName!.split('.').pop()!.toLowerCase());
}

export interface Revision {
  id: string;
  entryId: string;
  parentRevisionId: string | null;
  source: 'author' | 'agent' | 'review';
  snapshot: Entry & { content: string | null; attributes: ResourceAttributes | null };
  createdAt: number;
}
export type EntrySnapshot = Revision['snapshot'];
/** 历史列表中的一个正文版本；只改标题或位置的修订不列出。 */
export interface RevisionSummary {
  id: string;
  source: Revision['source'];
  wordCount: number;
  createdAt: number;
}

/** 一次删除移入作品回收站的条目；roots 为批次中父目录不在同批次的最外层条目，按原位置排序。 */
export interface TrashBatch {
  id: string;
  deletedAt: number;
  roots: Entry[];
  entryCount: number;
  /** 单独删除或随出处章节删除的事件。 */
  records: StoryRecordRef[];
  /** 单独删除的关系，以及建立／结束全部随出处章节删除的关系。 */
  relations: StoryRelationRef[];
  /** 随出处章节删除、所属关系仍在的建立／结束数量。 */
  milestoneCount: number;
}
/** 回收站中关系的摘要。 */
export interface StoryRelationRef {
  id: string;
  type: string;
  resourceIds: [string, string];
}
/** 回收站中事件的摘要。 */
export interface StoryRecordRef {
  id: string;
  text: string;
  resourceIds: string[];
}
export interface TrashEntriesInput {
  commandId: string;
  workId: string;
  entryIds: string[];
}
/** batchId 为 null 时清空整个作品回收站。 */
export interface TrashBatchInput {
  commandId: string;
  workId: string;
  batchId: string | null;
}
/** 作品库回收站中的作品。 */
export interface TrashedWork extends Work {
  deletedAt: number;
}
export interface WorkCommandInput {
  commandId: string;
  workId: string;
}

/** 删除前在确认框中展示的范围。 */
export interface TrashImpact {
  entryCount: number;
  pendingCount: number;
  /** 随出处章节移入回收站的事件。 */
  recordCount: number;
  /** 随出处章节移入回收站的关系建立／结束，含整条移走的关系中的。 */
  milestoneCount: number;
  /** 发生位置在被删章节、出处在别处的记录，删除后待重新定位。 */
  relocatedCount: number;
  /** 状态会改变的关系：从 fromChapterId 起显示为 state，removed 表示整条随章节移走。 */
  relationChanges: {
    relationId: string;
    type: string;
    resourceIds: [string, string];
    change: { kind: 'removed' } | { kind: 'state'; fromChapterId: string; state: 'active' | 'ended' | 'undetermined' };
  }[];
}

export interface CreateWorkInput {
  commandId: string;
  title: string;
  kind: Work['kind'];
}

export type CreateEntryInput = {
  commandId: string;
  workId: string;
  parentId: string | null;
  section: Entry['section'];
  title: string;
} & ({ kind: 'directory' } | { kind: 'document'; format: Document['format']; content: string });

/** 改名用于目录和文件条目；文稿与资料随正文保存改名。 */
export interface RenameEntryInput {
  commandId: string;
  workId: string;
  entryId: string;
  expectedRevisionId: string;
  title: string;
}

export interface MoveEntryInput {
  commandId: string;
  workId: string;
  entryId: string;
  expectedParentId: string | null;
  expectedPosition: number;
  parentId: string | null;
  /** 插到该同级条目前；null 表示移到末尾。 */
  beforeEntryId: string | null;
}

export interface SaveDocumentInput {
  commandId: string;
  workId: string;
  documentId: string;
  expectedRevisionId: string;
  title: string;
  format: Document['format'];
  content: string;
  /** 只用于资料；省略时保持当前属性。 */
  attributes?: ResourceAttributes;
}

/** 复制外部文件为资料区文件条目，原文件保持不动；按序提交，失败时返回已完成项。 */
export interface AddFilesInput {
  commandId: string;
  workId: string;
  parentId: string | null;
  paths: string[];
}
export interface AddFilesReport {
  entries: Entry[];
  failure: { path: string; message: string } | null;
}
/** 文件条目的当前文件；外部程序可能已修改，大小与修改时间按读取时为准。 */
export interface FileLocation {
  path: string;
  size: number;
  modifiedAt: number;
}

/** 检索只返回正式条目元数据；正文按文档身份和修订另行读取。 */
export interface SearchDocumentsInput {
  workId: string;
  query: string;
  section?: Entry['section'];
  offset: number;
  limit: number;
}

export interface DocumentSearchPage {
  entries: Entry[];
  hasMore: boolean;
}

export type CreationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CreationError | { code: 'invalid-request' | 'failed'; message: string } };

export type CreationError =
  | { code: 'revision-conflict'; message: string; expectedRevisionId: string; actualRevisionId: string }
  | { code: 'draft-conflict'; message: string; actualVersion: string | null }
  | { code: 'entry-location-conflict'; message: string; actualParentId: string | null; actualPosition: number };

export interface CreationReadCommands {
  listWorks: { input: Record<string, never>; output: CreationResult<Work[]> };
  listEntries: { input: { workId: string }; output: CreationResult<Entry[]> };
  readDocument: { input: { workId: string; documentId: string }; output: CreationResult<Document> };
  searchDocuments: { input: SearchDocumentsInput; output: CreationResult<DocumentSearchPage> };
}
