import type { Document, DocumentPosition, RecoveryDraft, ResourceAttributes } from '@chaptale/creation/contracts';

export type DocumentViewState = DocumentPosition;

/** 打开文稿后要定位到的正文：一个位置，或某一行里的一段（行号从 1 开始，from、to 是行内起止）。 */
export type RevealTarget =
  | { offset: number }
  | { line: number; from: number; to: number }
  | { kind: 'record' | 'relation'; id: string };

export interface EditorTab {
  id: string;
  workId: string;
  title: string;
  format: Document['format'];
  /** 资料属性的当前输入；文稿为 null。 */
  attributes: ResourceAttributes | null;
  document: Document | null;
  status: 'loading' | 'ready' | 'error';
  error: string;
  dirty: boolean;
  saving: boolean;
  saveError: string;
  recoveryError: string;
  draftVersion: string | null;
  recovery: RecoveryDraft | null;
  conflict: Document | null;
  words: number;
  generation: number;
}
