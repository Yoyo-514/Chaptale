/** 作品契约独立于 Node、SQLite、Electron 与 pi，可直接用于界面和传输。 */
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
  kind: 'directory' | 'document';
  title: string;
  position: number;
  format: 'txt' | 'markdown' | null;
  wordCount: number;
  revisionId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Document extends Entry {
  kind: 'document';
  format: 'txt' | 'markdown';
  content: string;
}

export interface Revision {
  id: string;
  entryId: string;
  parentRevisionId: string | null;
  source: 'author';
  snapshot: Entry & { content: string | null };
  createdAt: number;
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

export interface SaveDocumentInput {
  commandId: string;
  workId: string;
  documentId: string;
  expectedRevisionId: string;
  title: string;
  format: Document['format'];
  content: string;
}

export interface RecoveryDraft extends Omit<SaveDocumentInput, 'commandId'> {
  /** 此快照正式保存时沿用该 ID 作为命令 ID。 */
  id: string;
  updatedAt: number;
}

export interface DraftState {
  version: string | null;
  draft: RecoveryDraft | null;
}

export type WriteDraftInput = Omit<RecoveryDraft, 'id' | 'updatedAt'> & {
  draftId: string;
  expectedDraftVersion: string | null;
};

export type CreationError =
  | { code: 'revision-conflict'; message: string; expectedRevisionId: string; actualRevisionId: string }
  | { code: 'draft-conflict'; message: string; actualVersion: string | null };
