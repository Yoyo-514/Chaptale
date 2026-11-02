import type { RpcCommand } from '@chaptale/contracts';

import type {
  CreateEntryInput,
  CreationReadCommands,
  CreationResult,
  Entry,
  EntrySnapshot,
  MoveEntryInput,
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

/**
 * 分组身份跨问答与重启保留；候选仍按自身版本接受或拒绝。
 * continued 表示作者处理完后任务已继续；ended 表示作者结束了该任务，剩余候选作为历史待审保留。
 */
export interface DeliveryGroup {
  id: string;
  sessionId: string;
  version: string;
  status: 'pending' | 'continued' | 'ended';
  changeIds: string[];
}

export interface DeliveryView {
  group: DeliveryGroup;
  pendingCount: number;
}

/** 整篇接受、整篇拒绝，或作者逐处决定、手改过（以正式内容为准）；deleted：作者删除了目标，候选随删除一并拒绝。 */
export type DeliveryDecision = 'accepted' | 'rejected' | 'edited' | 'deleted' | 'sourceDeleted' | 'sourceRejected';
export type DeliveryContent =
  | {
      target: 'entry';
      workId: string;
      targetId: string;
      title: string;
      decision: DeliveryDecision;
      snapshot: EntrySnapshot | null;
    }
  | {
      target: 'record';
      workId: string;
      targetId: string;
      /** 候选中的事件内容，拒绝新建后仍可辨认是哪一条。 */
      text: string;
      decision: DeliveryDecision;
      snapshot: RecordSnapshot | null;
    }
  | {
      target: 'relation';
      workId: string;
      targetId: string;
      /** 候选中的关系类型，拒绝新建后仍可辨认是哪一条。 */
      type: string;
      decision: DeliveryDecision;
      snapshot: RelationSnapshot | null;
    };

/** 继续与结束任务都只推进当前组的进度。 */
export interface DeliveryProgressInput {
  commandId: string;
  sessionId: string;
  groupId: string;
  expectedVersion: string;
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

/** 组内一项待审修改的摘要；target 即作者看到的版本，整组决定按它校验。 */
interface DeliveryItemFields {
  target: ReviewTarget;
  workId: string;
  targetId: string;
  created: boolean;
  deleted: boolean;
  conflicted: boolean;
}
export type DeliveryItem =
  | (DeliveryItemFields & {
      kind: EntrySnapshot['kind'];
      section: EntrySnapshot['section'];
      title: string;
    })
  | (DeliveryItemFields & { kind: 'record'; record: RecordSnapshot })
  | (DeliveryItemFields & { kind: 'relation'; relation: RelationSnapshot });

export interface DeliverySummary {
  group: DeliveryGroup;
  items: DeliveryItem[];
}

/** 一次只处理一部作品，正式修订与回执在该作品库的一个事务中提交。 */
export interface DecideDeliveryInput {
  commandId: string;
  groupId: string;
  workId: string;
  decision: 'accept' | 'reject';
  /** 必须覆盖该组在此作品中的全部待审修改。 */
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
  /** 与 part 互斥：range 只决定正文的一处，part=title 只决定改名；都缺省时整体决定。 */
  range?: ReviewRange;
  part?: 'title';
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
  createEntry: { input: CreateEntryInput; output: CreationResult<AgentWriteResult> };
  writeDocument: { input: Omit<SaveDocumentInput, 'attributes'>; output: CreationResult<AgentWriteResult> };
  /** 整篇覆盖只改变正文；命令参数保持模型提交的快照，重试不依赖后续标题与格式。 */
  writeContent: { input: Omit<SaveDocumentInput, 'title' | 'format'>; output: CreationResult<AgentWriteResult> };
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
  /** 审阅模式包含本会话候选；asOf 为章节 ID 时只返回截至该章发生的事件和待定事件；sourceChanged 表示出处章节正文在核对后改过。 */
  listRecords: {
    input: { workId: string; resourceId: string | null; sourceId: string | null; asOf: string | null };
    output: CreationResult<(StoryRecord & { sourceChanged: boolean })[]>;
  };
  createRecord: { input: CreateRecordInput & { basis: string }; output: CreationResult<AgentWriteResult> };
  updateRecord: { input: UpdateRecordInput & { basis: string }; output: CreationResult<AgentWriteResult> };
  removeRecord: { input: RemoveRecordInput & { basis: string }; output: CreationResult<AgentWriteResult> };
  /** 审阅模式包含本会话候选；state 按 asOf 计算，types 为可选关系类型。 */
  listRelations: {
    input: { workId: string; resourceId: string | null; asOf: string | null };
    output: CreationResult<{
      relations: (Omit<StoryRelation, 'milestones'> & {
        milestones: (RelationMilestone & { sourceChanged: boolean })[];
        state: RelationState;
      })[];
      types: RelationType[];
    }>;
  };
  createRelation: { input: CreateRelationInput & { basis: string }; output: CreationResult<AgentWriteResult> };
  /** 只提交改动：省略的关系字段保持不变，未列出的建立或结束保持不变。 */
  updateRelation: { input: AgentRelationUpdate; output: CreationResult<AgentWriteResult> };
  removeRelation: { input: RemoveRelationInput & { basis: string }; output: CreationResult<AgentWriteResult> };
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
  { method: keyof CreationReadCommands | 'listRecords' | 'listRelations' }
>;

export interface ReviewCommands {
  readCurrentDelivery: { input: { sessionId: string }; output: CreationResult<DeliveryView | null> };
  readDeliveryGroup: { input: { groupId: string }; output: CreationResult<DeliveryView> };
  readDeliveryContents: { input: { groupId: string }; output: CreationResult<DeliveryContent[]> };
  continueDelivery: { input: DeliveryProgressInput; output: CreationResult<DeliveryGroup> };
  /** 作者结束当前任务；剩余候选保留为历史待审，不再自动继续。 */
  endDelivery: { input: DeliveryProgressInput; output: CreationResult<DeliveryGroup> };
  /** 当前组及仍有待审修改的历史组，按新到旧排列。 */
  listDeliveries: { input: { sessionId: string }; output: CreationResult<DeliverySummary[]> };
  decideDelivery: { input: DecideDeliveryInput; output: CreationResult<DeliveryGroup> };
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
