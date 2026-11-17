import type { DraftState, Entry, RecoveryDraft, WriteDraftInput } from '../contracts/index.ts';
import { assertNotTrashed, DraftConflictError } from '../errors.ts';
import type { CreationRepository, WorkRepository } from '../repository.ts';
import { saveParameters } from './mutations.ts';

export function writeDraft(repository: CreationRepository, input: WriteDraftInput): DraftState {
  const work = repository.work(input.workId);
  assertDocument(work, input.documentId);
  const entryId = work.getRevisionEntryId(input.expectedRevisionId);
  if (entryId === undefined) throw new Error('修订不存在');
  if (entryId !== input.documentId) throw new Error('恢复草稿的基线不属于当前文档');
  return repository.library.transaction(() => {
    const current = repository.library.getDraftState(input.workId, input.documentId);
    if (current.version === input.draftId) {
      if (!current.draft) throw new DraftConflictError(current.version);
      const draft = current.draft;
      if (
        draft.expectedRevisionId !== input.expectedRevisionId ||
        draft.title !== input.title ||
        draft.format !== input.format ||
        draft.content !== input.content ||
        JSON.stringify(draft.attributes) !== JSON.stringify(input.attributes)
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
      ...(input.attributes && { attributes: input.attributes }),
      updatedAt: Date.now()
    };
    repository.library.putDraft(draft);
    return { version: draft.id, draft };
  });
}

export function discardDraft(
  repository: CreationRepository,
  workId: string,
  documentId: string,
  version: string
): DraftState {
  assertDocument(repository.work(workId), documentId);
  return repository.library.transaction(() => {
    const current = repository.library.getDraftState(workId, documentId);
    if (current.version !== version) throw new DraftConflictError(current.version);
    repository.library.clearDraft(workId, documentId, version);
    return { version, draft: null };
  });
}

export function readDraftState(repository: CreationRepository, workId: string, documentId: string): DraftState {
  const work = repository.work(workId);
  assertDocument(work, documentId);
  return repository.library.transaction(() => {
    const state = repository.library.getDraftState(workId, documentId);
    if (!state.draft || work.readReceipt<Entry>(state.draft.id, saveParameters(state.draft)) === undefined)
      return state;
    repository.library.clearDraft(workId, documentId, state.draft.id);
    return { version: state.version, draft: null };
  });
}
function assertDocument(work: WorkRepository, documentId: string): void {
  const entry = work.getEntry(documentId);
  if (!entry) assertNotTrashed(work, documentId);
  if (!entry || entry.kind !== 'document') throw new Error('文稿或资料不存在');
}
