import { saveParameters } from './content/mutations.ts';
import type { DraftState, Entry, RecoveryDraft, WriteDraftInput } from './contracts.ts';
import { assertNotTrashed, DraftConflictError } from './errors.ts';
import type { CreationRepository } from './repository.ts';

export function writeDraft(repository: CreationRepository, input: WriteDraftInput): DraftState {
  assertDocument(repository, input.workId, input.documentId);
  const entryId = repository.getRevisionEntryId(input.workId, input.expectedRevisionId);
  if (entryId === undefined) throw new Error('修订不存在');
  if (entryId !== input.documentId) throw new Error('恢复草稿的基线不属于当前文档');
  return repository.libraryTransaction(() => {
    const current = repository.getDraftState(input.workId, input.documentId);
    if (current.version === input.draftId) {
      if (!current.draft) throw new DraftConflictError(current.version);
      const draft = current.draft;
      if (
        draft.expectedRevisionId !== input.expectedRevisionId ||
        draft.title !== input.title ||
        draft.format !== input.format ||
        draft.content !== input.content
      ) {
        throw new Error('同一草稿身份不能用于不同内容');
      }
      return current;
    }
    if (current.version !== input.expectedDraftVersion) throw new DraftConflictError(current.version);
    const draft: RecoveryDraft = {
      id: input.draftId,
      workId: input.workId,
      documentId: input.documentId,
      expectedRevisionId: input.expectedRevisionId,
      title: input.title,
      format: input.format,
      content: input.content,
      updatedAt: Date.now()
    };
    repository.putDraft(draft);
    return { version: draft.id, draft };
  });
}

export function discardDraft(
  repository: CreationRepository,
  workId: string,
  documentId: string,
  version: string
): DraftState {
  assertDocument(repository, workId, documentId);
  return repository.libraryTransaction(() => {
    const current = repository.getDraftState(workId, documentId);
    if (current.version !== version) throw new DraftConflictError(current.version);
    repository.clearDraft(workId, documentId, version);
    return { version, draft: null };
  });
}

export function readDraftState(repository: CreationRepository, workId: string, documentId: string): DraftState {
  assertDocument(repository, workId, documentId);
  return repository.libraryTransaction(() => {
    const state = repository.getDraftState(workId, documentId);
    if (
      !state.draft ||
      repository.readWorkReceipt<Entry>(workId, state.draft.id, saveParameters(state.draft)) === undefined
    )
      return state;
    repository.clearDraft(workId, documentId, state.draft.id);
    return { version: state.version, draft: null };
  });
}
function assertDocument(repository: CreationRepository, workId: string, documentId: string): void {
  const entry = repository.getEntry(workId, documentId);
  if (!entry) assertNotTrashed(repository, workId, documentId);
  if (!entry || entry.kind !== 'document') throw new Error('文稿或资料不存在');
}
