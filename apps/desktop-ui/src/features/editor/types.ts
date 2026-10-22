import type { Document, DocumentPosition, RecoveryDraft } from '@chaptale/creation/contracts';

export type DocumentViewState = DocumentPosition;

export interface EditorTab {
  id: string;
  workId: string;
  title: string;
  format: Document['format'];
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
