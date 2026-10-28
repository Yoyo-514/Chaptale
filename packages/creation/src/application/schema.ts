import { Type, type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

import type { CreationAgentCommands, CreationAuthorCommands } from '../contracts.ts';

const id = Type.String({ minLength: 1 });
const parentId = Type.Union([id, Type.Null()]);
const format = Type.Union([Type.Literal('txt'), Type.Literal('markdown')]);
const documentTarget = { workId: id, documentId: id };
const documentInput = {
  ...documentTarget,
  expectedRevisionId: id,
  title: Type.String(),
  format,
  content: Type.String()
};
const entryInput = {
  commandId: id,
  workId: id,
  parentId,
  title: Type.String(),
  section: Type.Union([Type.Literal('manuscript'), Type.Literal('resource')])
};
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const offset = Type.Integer({ minimum: 0 });
const scroll = Type.Number({ minimum: 0 });
const treeState = object({ expandedIds: Type.Array(id), selectedId: parentId, scrollTop: scroll });
const workbenchState = object({
  activeWorkId: parentId,
  works: Type.Array(
    object({
      workId: id,
      activeDocumentId: parentId,
      secondaryDocumentId: parentId,
      tabs: Type.Array(object({ documentId: id, anchor: offset, head: offset, scrollTop: scroll, scrollLeft: scroll })),
      section: entryInput.section,
      manuscript: treeState,
      resource: treeState
    })
  )
});
const reviewTarget = {
  changeId: id,
  expectedVersion: id,
  expectedRevisionId: parentId,
  expectedLocation: Type.Union([object({ parentId, position: offset }), Type.Null()])
};
const inputs = {
  listWorks: object({}),
  listEntries: object({ workId: id }),
  searchDocuments: object({
    workId: id,
    query: Type.String({ minLength: 1, pattern: '\\S' }),
    section: Type.Optional(entryInput.section),
    offset,
    limit: Type.Integer({ minimum: 1 })
  }),
  readSessionState: object({}),
  assignSession: object({ sessionId: id, workId: id }),
  selectSession: object({ sessionId: parentId, workId: parentId }),
  forgetSessions: object({ sessionIds: Type.Array(id) }),
  readWorkbench: object({}),
  writeWorkbench: workbenchState,
  createWork: object({
    commandId: id,
    title: Type.String(),
    kind: Type.Union([Type.Literal('novel'), Type.Literal('script')])
  }),
  createEntry: Type.Union([
    object({ ...entryInput, kind: Type.Literal('directory') }),
    object({ ...entryInput, kind: Type.Literal('document'), format, content: Type.String() })
  ]),
  saveDocument: object({ commandId: id, ...documentInput }),
  readDocument: object(documentTarget),
  renameDirectory: object({ commandId: id, workId: id, directoryId: id, expectedRevisionId: id, title: Type.String() }),
  moveEntry: object({
    commandId: id,
    workId: id,
    entryId: id,
    expectedParentId: parentId,
    expectedPosition: offset,
    parentId,
    beforeEntryId: parentId
  }),
  listTrash: object({ workId: id }),
  previewTrash: object({ workId: id, entryIds: Type.Array(id, { minItems: 1 }) }),
  trashEntries: object({ commandId: id, workId: id, entryIds: Type.Array(id, { minItems: 1 }) }),
  restoreTrash: object({ commandId: id, workId: id, batchId: id }),
  purgeTrash: object({ commandId: id, workId: id, batchId: parentId }),
  listTrashedWorks: object({}),
  previewTrashWork: object({ workId: id }),
  trashWork: object({ commandId: id, workId: id }),
  restoreWork: object({ commandId: id, workId: id }),
  purgeWork: object({ commandId: id, workId: id }),
  readTrashedDocument: object(documentTarget),
  writeDraft: object({ ...documentInput, draftId: id, expectedDraftVersion: parentId }),
  discardDraft: object({ ...documentTarget, draftId: id }),
  readDraftState: object(documentTarget),
  readRevision: object({ workId: id, revisionId: id }),
  snapshot: object({ workId: parentId }),
  readChanges: object({
    cursor: object({ workId: parentId, sequence: offset, token: parentId }),
    limit: Type.Integer({ minimum: 1 })
  }),
  readCurrentDelivery: object({ sessionId: id }),
  readDeliveryGroup: object({ groupId: id }),
  readDeliveryContents: object({ groupId: id }),
  continueDelivery: object({ commandId: id, sessionId: id, groupId: id, expectedVersion: id }),
  endDelivery: object({ commandId: id, sessionId: id, groupId: id, expectedVersion: id }),
  listDeliveries: object({ sessionId: id }),
  decideDelivery: object({
    commandId: id,
    groupId: id,
    workId: id,
    decision: Type.Union([Type.Literal('accept'), Type.Literal('reject')]),
    targets: Type.Array(object(reviewTarget))
  }),
  listPendingChanges: object({ workId: parentId, sessionId: parentId }),
  readReview: object({ changeId: id }),
  updateReview: object({
    ...reviewTarget,
    commandId: id,
    title: Type.String(),
    content: Type.Union([Type.String(), Type.Null()]),
    resolveConflicts: Type.Boolean()
  }),
  decideReview: object({
    ...reviewTarget,
    commandId: id,
    decision: Type.Union([Type.Literal('accept'), Type.Literal('reject')]),
    range: Type.Optional(object({ fromA: offset, toA: offset, fromB: offset, toB: offset })),
    part: Type.Optional(Type.Literal('title'))
  })
} satisfies Record<keyof CreationAuthorCommands, TSchema>;

export const agentInputs = {
  listWorks: inputs.listWorks,
  listEntries: inputs.listEntries,
  readDocument: inputs.readDocument,
  searchDocuments: inputs.searchDocuments,
  createEntry: inputs.createEntry,
  writeDocument: inputs.saveDocument,
  writeContent: object({ commandId: id, ...documentTarget, expectedRevisionId: id, content: Type.String() }),
  moveEntry: inputs.moveEntry,
  deleteEntry: object({ commandId: id, workId: id, entryId: id, expectedRevisionId: id }),
  renameEntry: object({ commandId: id, workId: id, entryId: id, expectedRevisionId: id, title: Type.String() }),
  editDocument: object({
    commandId: id,
    ...documentTarget,
    expectedRevisionId: id,
    oldText: Type.String({ minLength: 1 }),
    newText: Type.String()
  })
} satisfies Record<keyof CreationAgentCommands, TSchema>;

function commands(schemas: Record<string, TSchema>) {
  return Compile(
    Type.Union(Object.entries(schemas).map(([method, input]) => object({ method: Type.Literal(method), input })))
  );
}
export const authorValidator = commands(inputs);
export const agentValidator = commands(agentInputs);
