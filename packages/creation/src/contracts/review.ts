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

export type CreationMode = 'discuss' | 'review' | 'direct';
/** 身份和当前模式由宿主注入，不接受工具参数自报。 */
export interface CreationAgentContext {
  sessionId: string;
  mode: CreationMode;
}

export interface ReviewConflict {
  field: 'content' | 'title' | 'format' | 'parentId' | 'position';
  base: string | null;
  current: string | null;
  proposed: string | null;
}

export interface PendingChange {
  id: string;
  workId: string;
  sessionId: string;
  entryId: string;
  version: string;
  /** 会话内结构修改的逻辑顺序，与设备时间无关。 */
  order: number;
  base: EntrySnapshot | null;
  candidate: EntrySnapshot;
  authorEdited: boolean;
  conflicts: ReviewConflict[];
  status: 'pending' | 'accepted' | 'rejected';
  updatedAt: number;
}

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

export interface DeliveryContent {
  workId: string;
  entryId: string;
  snapshot: EntrySnapshot | null;
}

/** 继续与结束任务都只推进当前组的进度。 */
export interface DeliveryProgressInput {
  commandId: string;
  sessionId: string;
  groupId: string;
  expectedVersion: string;
}

export interface ReviewView {
  change: PendingChange;
  current: EntrySnapshot | null;
  candidate: EntrySnapshot;
  conflicts: ReviewConflict[];
}

export interface ReviewTarget {
  changeId: string;
  expectedVersion: string;
  expectedRevisionId: string | null;
  expectedLocation: { parentId: string | null; position: number } | null;
}

/** 组内一项待审修改的摘要；target 即作者看到的版本，整组决定按它校验。 */
export interface DeliveryItem {
  target: ReviewTarget;
  workId: string;
  entryId: string;
  section: EntrySnapshot['section'];
  kind: EntrySnapshot['kind'];
  title: string;
  created: boolean;
  conflicted: boolean;
}

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
  range?: ReviewRange;
}

export interface UpdateReviewInput extends ReviewTarget {
  commandId: string;
  title: string;
  content: string | null;
  /** 作者检查冲突后显式确认解决；每次修改生成新的候选版本。 */
  resolveConflicts: boolean;
}

export type AgentWriteResult = { kind: 'pending'; change: PendingChange } | { kind: 'saved'; entry: Entry };
export interface CreationAgentCommands extends CreationReadCommands {
  createEntry: { input: CreateEntryInput; output: CreationResult<AgentWriteResult> };
  writeDocument: { input: SaveDocumentInput; output: CreationResult<AgentWriteResult> };
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
}
export type CreationAgentCommand = RpcCommand<CreationAgentCommands>;
export type AgentWriteCommand = Exclude<CreationAgentCommand, { method: keyof CreationReadCommands }>;

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
}
