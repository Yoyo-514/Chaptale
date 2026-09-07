import type { ReadDocumentResult, WorkspaceDocument } from '@chaptale/ipc-contract';

export type DocumentViewState = { anchor: number; head: number; scrollTop: number; scrollLeft: number };

export type EditorTab = {
  id: string;
  path: string;
  title: string;
  readonly: boolean;
  dirty: boolean;
  status: 'loading' | 'ready' | 'error';
  document: WorkspaceDocument | null;
  error: Extract<ReadDocumentResult, { ok: false }> | null;
  allowLarge: boolean;
  viewState?: DocumentViewState;
  saving?: boolean;
  saveError?: string;
  words?: number;
  generation?: number;
};

/** 常规预览的预算；更大的文件需要显式打开，并关闭换行与语法解析。 */
export const NORMAL_PREVIEW_BYTES = 8 * 1024 * 1024;
