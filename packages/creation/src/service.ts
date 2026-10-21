import { randomUUID } from 'node:crypto';

import { countDocumentWords } from '@chaptale/shared';

import type {
  CreateEntryInput,
  CreateWorkInput,
  Document,
  DraftState,
  Entry,
  Revision,
  SaveDocumentInput,
  Work,
  WriteDraftInput
} from './contracts.ts';
import { discardDraft, writeDraft } from './drafts.ts';
import { RevisionConflictError } from './errors.ts';
import type { CreationRepository } from './repository.ts';

/** 作品规则只依赖持久化契约；具体存储由宿主启动代码注入。 */
export class CreationService {
  private readonly repository: CreationRepository;

  constructor(repository: CreationRepository) {
    this.repository = repository;
  }

  createWork(input: CreateWorkInput): Work {
    return this.repository.libraryCommand(input.commandId, ['createWork', input.title, input.kind], () => {
      const now = Date.now();
      const work: Work = { id: randomUUID(), title: input.title, kind: input.kind, createdAt: now, updatedAt: now };
      this.repository.insertWork(work);
      return work;
    });
  }

  listWorks(): Work[] {
    return this.repository.listWorks();
  }

  createEntry(input: CreateEntryInput): Entry {
    const content = input.kind === 'document' ? input.content : null;
    const format = input.kind === 'document' ? input.format : null;
    return this.repository.workCommand(
      input.workId,
      input.commandId,
      ['createEntry', input.workId, input.parentId, input.section, input.kind, input.title, format, content],
      () => {
        if (input.parentId !== null) {
          const parent = this.repository.getEntry(input.workId, input.parentId);
          if (!parent || parent.kind !== 'directory' || parent.section !== input.section) {
            throw new Error('目标目录不存在或不属于当前内容区域');
          }
        }
        const now = Date.now();
        const entry: Entry = {
          id: randomUUID(),
          parentId: input.parentId,
          section: input.section,
          kind: input.kind,
          title: input.title,
          position: this.repository.nextPosition(input.workId, input.section, input.parentId),
          format,
          wordCount: content === null ? 0 : countDocumentWords(content),
          revisionId: randomUUID(),
          createdAt: now,
          updatedAt: now
        };
        const snapshot = { ...entry, content };
        this.repository.insertEntry(input.workId, snapshot, revisionFor(snapshot, null));
        return entry;
      }
    );
  }

  listEntries(workId: string): Entry[] {
    return this.repository.listEntries(workId);
  }

  readDocument(workId: string, documentId: string): Document {
    const document = this.repository.getDocument(workId, documentId);
    if (!document) throw new Error('文稿或资料不存在');
    return document;
  }

  saveDocument(input: SaveDocumentInput): Entry {
    const result = this.repository.workCommand(input.workId, input.commandId, saveParameters(input), () => {
      const current = this.readDocument(input.workId, input.documentId);
      if (current.revisionId !== input.expectedRevisionId) {
        throw new RevisionConflictError(input.expectedRevisionId, current.revisionId);
      }
      const { content: currentContent, ...metadata } = current;
      if (metadata.title === input.title && metadata.format === input.format && currentContent === input.content)
        return metadata;
      const { content, ...saved } = {
        ...current,
        title: input.title,
        format: input.format,
        content: input.content,
        wordCount: countDocumentWords(input.content),
        revisionId: randomUUID(),
        updatedAt: Date.now()
      };
      const snapshot = { ...saved, content };
      this.repository.updateDocument(input.workId, snapshot, revisionFor(snapshot, current.revisionId));
      return saved;
    });
    this.repository.clearDraft(input.workId, input.documentId, input.commandId);
    return result;
  }

  readRevision(workId: string, revisionId: string): Revision {
    const revision = this.repository.getRevision(workId, revisionId);
    if (!revision) throw new Error('修订不存在');
    return revision;
  }

  writeDraft(input: WriteDraftInput): DraftState {
    this.assertDocument(input.workId, input.documentId);
    const entryId = this.repository.getRevisionEntryId(input.workId, input.expectedRevisionId);
    if (entryId === undefined) throw new Error('修订不存在');
    if (entryId !== input.documentId) throw new Error('恢复草稿的基线不属于当前文档');
    return writeDraft(this.repository, input);
  }

  readDraftState(workId: string, documentId: string): DraftState {
    this.assertDocument(workId, documentId);
    return this.repository.libraryTransaction(() => {
      const state = this.repository.getDraftState(workId, documentId);
      if (
        !state.draft ||
        this.repository.readWorkReceipt<Entry>(workId, state.draft.id, saveParameters(state.draft)) === undefined
      ) {
        return state;
      }
      this.repository.clearDraft(workId, documentId, state.draft.id);
      return { version: state.version, draft: null };
    });
  }

  discardDraft(workId: string, documentId: string, version: string): DraftState {
    this.assertDocument(workId, documentId);
    return discardDraft(this.repository, workId, documentId, version);
  }

  close(): void {
    this.repository.close();
  }

  private assertDocument(workId: string, documentId: string): void {
    const entry = this.repository.getEntry(workId, documentId);
    if (!entry || entry.kind !== 'document') throw new Error('文稿或资料不存在');
  }
}

function saveParameters(input: Omit<SaveDocumentInput, 'commandId'>): readonly unknown[] {
  return [
    'saveDocument',
    input.workId,
    input.documentId,
    input.expectedRevisionId,
    input.title,
    input.format,
    input.content
  ];
}

function revisionFor(snapshot: Revision['snapshot'], parentRevisionId: string | null): Revision {
  return {
    id: snapshot.revisionId,
    entryId: snapshot.id,
    parentRevisionId,
    source: 'author',
    snapshot,
    createdAt: snapshot.updatedAt
  };
}
