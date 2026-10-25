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
  listPendingChanges: {
    input: { workId: string | null; sessionId: string | null };
    output: CreationResult<PendingChange[]>;
  };
  readReview: { input: { changeId: string }; output: CreationResult<ReviewView> };
  updateReview: { input: UpdateReviewInput; output: CreationResult<PendingChange> };
  decideReview: { input: DecideReviewInput; output: CreationResult<PendingChange> };
}
