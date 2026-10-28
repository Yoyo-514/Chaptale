import type { Document, DocumentPosition, RecoveryDraft, ResourceAttributes } from '@chaptale/creation/contracts';

export type DocumentViewState = DocumentPosition;

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
