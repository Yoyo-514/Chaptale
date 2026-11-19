import type { RpcCommand } from '@chaptale/contracts';

import type {
  CreateEntryInput,
  CreationReadCommands,
  CreationResult,
  Document,
  Entry,
  EntrySnapshot,
  MoveEntryInput,
  ResourceAttributePatch,
  ResourceAttributes,
  SaveDocumentInput
} from './content.ts';
import type {
  CreateRecordInput,
  RecordFields,
  RecordSnapshot,
  RemoveRecordInput,
  StoryRecord,
  UpdateRecordInput
} from './records.ts';
import type {
  CreateRelationInput,
  MilestoneInput,
  RelationInput,
  RelationMilestone,
  RelationSnapshot,
  RelationState,
  RelationType,
  RemoveRelationInput,
  StoryRelation
} from './relations.ts';

export type CreationMode = 'discuss' | 'review' | 'direct';
/** 身份和当前模式由宿主注入，不接受工具参数自报。 */
export interface CreationAgentContext {
  sessionId: string;
  mode: CreationMode;
}

export interface ReviewConflict {
  field:
    | 'content'
    | 'title'
    | 'format'
    | 'parentId'
    | 'position'
    | 'text'
    | 'resourceIds'
    | 'source'
    | 'placement'
    | 'storyTime'
    | 'type'
    | 'aliases'
    | 'tags'
    | 'directed'
    | 'titles'
    | 'milestone';
  /** field 为 milestone 时指向冲突的建立或结束。 */
  milestoneId?: string;
  base: string | null;
  current: string | null;
  proposed: string | null;
}

interface ChangeFields {
  id: string;
  workId: string;
  sessionId: string;
  /** 条目、事件或关系的身份。 */
  targetId: string;
  version: string;
  /** 会话内结构修改的逻辑顺序，与设备时间无关。 */
  order: number;
  authorEdited: boolean;
  conflicts: ReviewConflict[];
  /**
   * covered：并入同会话删除候选的修改，删除被接受时一并拒绝，被拒绝时恢复为 pending。
   */
  status: 'pending' | 'accepted' | 'rejected' | 'covered';
  updatedAt: number;
}
export interface EntryChange extends ChangeFields {
  target: 'entry';
  base: EntrySnapshot | null;
  candidate: EntrySnapshot;
  /** Agent 提出的删除：候选为删除时的条目快照，只能整篇接受或拒绝，接受后移入作品回收站。 */
  deleted?: true;
  /** 删除候选所并入的同会话修改。 */
  covers?: string[];
}
export interface RecordChange extends ChangeFields {
  target: 'record';
  base: RecordSnapshot | null;
  candidate: RecordSnapshot;
  /** Agent 提出的移除：接受后事件移入作品回收站。 */
  deleted?: true;
  /** Agent 给出的原文依据，只供审阅参考，不进入正式数据。 */
  basis: string;
}
export interface RelationChange extends ChangeFields {
  target: 'relation';
  base: RelationSnapshot | null;
  candidate: RelationSnapshot;
  /** Agent 提出的移除：接受后关系移入作品回收站。 */
  deleted?: true;
  /** Agent 给出的原文依据，只供审阅参考，不进入正式数据。 */
  basis: string;
}
export type PendingChange = EntryChange | RecordChange | RelationChange;

/** 每次作者决定按审阅单元记录；保存手改候选仍保持待审。 */
export type ReviewDecision = 'accepted' | 'rejected' | 'deleted' | 'sourceDeleted' | 'sourceRejected';
export type ReviewResultValue =
  | string
  | EntrySnapshot
  | RecordSnapshot
  | RelationSnapshot
  | ResourceAttributes
  | { parentId: string | null; position: number }
  | null;
export interface ReviewResult {
  id: string;
  workId: string;
  sessionId: string;
  changeId: string;
  targetId: string;
  target: PendingChange['target'];
  label: string;
  part: 'body' | 'title' | 'attributes' | 'location' | 'entry' | 'record' | 'relation';
  decision: ReviewDecision;
  authorEdited: boolean;
  before: ReviewResultValue;
  proposed: ReviewResultValue;
}
/** 发消息时捕获该目标的最新正式稿，与决定时的原文和候选片段分开。 */
export interface ReviewResultContent extends ReviewResult {
  snapshot: EntrySnapshot | RecordSnapshot | RelationSnapshot | null;
}
/** 接受前保存决定及其片段；恢复时只补齐已有作品回执对应的本机进度。 */
export interface ReviewIntent {
  input: DecideReviewInput;
  results: ReviewResult[];
}
export interface ReviewBatchIntent {
  input: DecidePendingInput;
  results: ReviewResult[];
}

export interface EntryReviewView {
  change: EntryChange;
  current: EntrySnapshot | null;
  candidate: EntrySnapshot;
  conflicts: ReviewConflict[];
}
export interface RecordReviewView {
  change: RecordChange;
  current: StoryRecord | null;
  candidate: RecordSnapshot;
  conflicts: ReviewConflict[];
}
export interface RelationReviewView {
  change: RelationChange;
  current: StoryRelation | null;
  candidate: RelationSnapshot;
  conflicts: ReviewConflict[];
}
export type ReviewView = EntryReviewView | RecordReviewView | RelationReviewView;

export interface ReviewTarget {
  changeId: string;
  expectedVersion: string;
  expectedRevisionId: string | null;
  /** 事件与关系没有目录位置，为 null。 */
  expectedLocation: { parentId: string | null; position: number } | null;
}

/** 当前会话的一项待审摘要；批量决定按作者看到的版本校验。 */
interface ReviewItemFields {
  count: number;
  target: ReviewTarget;
  workId: string;
  targetId: string;
  created: boolean;
  deleted: boolean;
  conflicted: boolean;
}
export type ReviewItem =
  | (ReviewItemFields & {
      kind: EntrySnapshot['kind'];
      section: EntrySnapshot['section'];
      title: string;
    })
  | (ReviewItemFields & { kind: 'record'; record: RecordSnapshot })
  | (ReviewItemFields & { kind: 'relation'; relation: RelationSnapshot });

/** 一次只处理一部作品，正式修订与回执在该作品库的一个事务中提交。 */
export interface DecidePendingInput {
  commandId: string;
  sessionId: string;
  workId: string;
  decision: 'accept' | 'reject';
  /** 覆盖本会话在此作品中的全部待审修改。 */
  targets: ReviewTarget[];
}

/** 两侧位置是 UTF-16 字符偏移，与编辑器一致。 */
export interface ReviewRange {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

export interface DecideReviewInput extends ReviewTarget {
  commandId: string;
  decision: 'accept' | 'reject';
  /** 与 part 互斥：range 决定一处正文，part 决定标题或整组资料属性；都缺省时整体决定。 */
  range?: ReviewRange;
  part?: 'title' | 'attributes';
}

export interface UpdateReviewInput extends ReviewTarget {
  commandId: string;
  title: string;
  content: string | null;
  /** 作者检查冲突后显式确认解决；每次修改生成新的候选版本。 */
  resolveConflicts: boolean;
}

/** 作者手改事件候选；每次修改生成新的候选版本。 */
export interface UpdateRecordReviewInput extends ReviewTarget, RecordFields {
  commandId: string;
  resolveConflicts: boolean;
}

/** 作者手改关系候选；每次修改生成新的候选版本。 */
export interface UpdateRelationReviewInput extends ReviewTarget, RelationInput {
  commandId: string;
  resolveConflicts: boolean;
}

/** 把依赖本会话新资料候选的事件与关系候选改为关联已有资料，并拒绝该新资料候选。 */
export interface RelinkResourceInput {
  commandId: string;
  changeId: string;
  expectedVersion: string;
  resourceId: string;
}

export type AgentWriteResult =
  | { kind: 'pending'; change: PendingChange }
  | { kind: 'saved'; entry: Entry }
  | { kind: 'record'; record: StoryRecord; removed: boolean }
  | { kind: 'relation'; relation: StoryRelation; removed: boolean }
  /** 直接修改模式下的删除，返回进入回收站的全部条目。 */
  | { kind: 'trashed'; entries: Entry[] }
  /** 审阅模式下删除本会话尚未接受的新建条目，撤回这些候选。 */
  | { kind: 'withdrawn'; change: PendingChange };
export interface CreationAgentCommands extends CreationReadCommands {
  createEntry: {
    input: CreateEntryInput & { attributes?: ResourceAttributePatch };
    output: CreationResult<AgentWriteResult>;
  };
  writeDocument: {
    input: Omit<SaveDocumentInput, 'attributes'> & { attributes?: ResourceAttributePatch };
    output: CreationResult<AgentWriteResult>;
  };
  /** 更新正文或资料属性；省略的字段保持不变，命令重试沿用提交时的参数快照。 */
  writeContent: {
    input: Pick<SaveDocumentInput, 'commandId' | 'workId' | 'documentId' | 'expectedRevisionId'> &
      (
        | { content: string; attributes?: ResourceAttributePatch }
        | { content?: string; attributes: ResourceAttributePatch }
      );
    output: CreationResult<AgentWriteResult>;
  };
  editDocument: {
    input: {
      commandId: string;
      workId: string;
      documentId: string;
      expectedRevisionId: string;
      oldText: string;
      newText: string;
    };
    output: CreationResult<AgentWriteResult>;
  };
  renameEntry: {
    input: { commandId: string; workId: string; entryId: string; expectedRevisionId: string; title: string };
    output: CreationResult<AgentWriteResult>;
  };
  moveEntry: { input: MoveEntryInput; output: CreationResult<AgentWriteResult> };
  deleteEntry: {
    input: { commandId: string; workId: string; entryId: string; expectedRevisionId: string };
    output: CreationResult<AgentWriteResult>;
  };
  /** 审阅模式下读到本会话候选时 pending 为 true。 */
  readDocument: {
    input: { workId: string; documentId: string };
    output: CreationResult<Document & { pending: boolean }>;
  };
  searchWork: { input: SearchWorkInput; output: CreationResult<WorkSearchPage> };
  /** 审阅模式包含本会话候选（pending 为 true）；asOf 为章节 ID 时只返回截至该章发生的事件和待定事件；sourceChanged 表示出处章节正文在核对后改过。 */
  listRecords: {
    input: { workId: string; resourceId: string | null; sourceId: string | null; asOf: string | null };
    output: CreationResult<AgentRecord[]>;
  };
  createRecord: { input: CreateRecordInput & { basis: string }; output: CreationResult<AgentWriteResult> };
  updateRecord: { input: UpdateRecordInput & { basis: string }; output: CreationResult<AgentWriteResult> };
  removeRecord: { input: RemoveRecordInput & { basis: string }; output: CreationResult<AgentWriteResult> };
  /** 审阅模式包含本会话候选（pending 为 true）；state 按 asOf 计算，types 为可选关系类型。 */
  listRelations: {
    input: { workId: string; resourceId: string | null; asOf: string | null };
    output: CreationResult<{ relations: AgentRelation[]; types: RelationType[] }>;
  };
  createRelation: { input: CreateRelationInput & { basis: string }; output: CreationResult<AgentWriteResult> };
  /** 只提交改动：省略的关系字段保持不变，未列出的建立或结束保持不变。 */
  updateRelation: { input: AgentRelationUpdate; output: CreationResult<AgentWriteResult> };
  removeRelation: { input: RemoveRelationInput & { basis: string }; output: CreationResult<AgentWriteResult> };
}
/** Agent 看到的事件与关系：pending 为本会话待接受的修改，sourceChanged 表示出处章节正文在核对后改过。 */
export type AgentRecord = StoryRecord & { sourceChanged: boolean; pending: boolean };
export type AgentRelation = Omit<StoryRelation, 'milestones'> & {
  milestones: (RelationMilestone & { sourceChanged: boolean })[];
  state: RelationState;
  pending: boolean;
};

/**
 * 检索正文、资料、事件和关系；section 只留该分区的条目，asOf 为章节 ID 时只到该章。
 * query 是空格分隔的关键词，按字面匹配；question 是一句话，按意思查找。两者至少给一个，都给时合并两边的排名。
 */
export interface SearchWorkInput {
  workId: string;
  query?: string;
  question?: string;
  section?: Entry['section'];
  asOf?: string;
  offset: number;
  limit: number;
}

/** 命中的一段原文；行号从 1 开始，与按行读取正文一致。 */
export interface SearchPassage {
  startLine: number;
  endLine: number;
  text: string;
}

/**
 * 条目命中附最相关的几段原文，文件条目或只命中标题、别名时为空；pending 表示读到的是本会话待接受的修改。
 * 资料不随进度，指定 asOf 时资料条目的 ignoresAsOf 为 true。
 */
export type WorkSearchHit = (
  | { kind: 'entry'; entry: Entry; pending: boolean; ignoresAsOf: boolean; passages: SearchPassage[] }
  | { kind: 'record'; record: AgentRecord }
  | { kind: 'relation'; relation: AgentRelation }
) &
  SearchMatchSource;

/** 命中来自关键词、语义还是两者；语义命中附与问题的余弦相似度，条目取最接近的一段。 */
export interface SearchMatchSource {
  matchedBy: 'keyword' | 'semantic' | 'both';
  similarity?: number;
}

export interface WorkSearchPage {
  hits: WorkSearchHit[];
  hasMore: boolean;
}

/** 建立或结束的改动：新增 id 为 null，修改给出整条内容，移除只需 id。 */
export type MilestonePatch = MilestoneInput | { id: string; remove: true };
export interface AgentRelationUpdate extends Partial<Omit<RelationInput, 'milestones'>> {
  commandId: string;
  workId: string;
  relationId: string;
  expectedRevisionId: string;
  milestones: MilestonePatch[];
  basis: string;
}
export type CreationAgentCommand = RpcCommand<CreationAgentCommands>;
export type AgentWriteCommand = Exclude<
  CreationAgentCommand,
  { method: keyof CreationReadCommands | 'searchWork' | 'listRecords' | 'listRelations' }
>;

export interface ReviewCommands {
  listReviewItems: { input: { sessionId: string }; output: CreationResult<ReviewItem[]> };
  listReviewResults: { input: { sessionId: string }; output: CreationResult<ReviewResultContent[]> };
  reportReviewResults: { input: { sessionId: string; resultIds: string[] }; output: CreationResult<null> };
  decidePending: { input: DecidePendingInput; output: CreationResult<{ sessionId: string; count: number }> };
  listPendingChanges: {
    input: { workId: string | null; sessionId: string | null };
    output: CreationResult<PendingChange[]>;
  };
  readReview: { input: { changeId: string }; output: CreationResult<ReviewView> };
  updateReview: { input: UpdateReviewInput; output: CreationResult<PendingChange> };
  decideReview: { input: DecideReviewInput; output: CreationResult<PendingChange> };
  updateRecordReview: { input: UpdateRecordReviewInput; output: CreationResult<PendingChange> };
  updateRelationReview: { input: UpdateRelationReviewInput; output: CreationResult<PendingChange> };
  /** 返回被拒绝的新资料候选。 */
  relinkResource: { input: RelinkResourceInput; output: CreationResult<PendingChange> };
}
