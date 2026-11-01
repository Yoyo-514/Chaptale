import { Type, type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

import type { CreationAgentCommands, CreationAuthorCommands } from '../contracts.ts';

const id = Type.String({ minLength: 1 });
const parentId = Type.Union([id, Type.Null()]);
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const format = Type.Union([Type.Literal('txt'), Type.Literal('markdown')]);
const documentTarget = { workId: id, documentId: id };
const documentInput = {
  ...documentTarget,
  expectedRevisionId: id,
  title: Type.String(),
  format,
  content: Type.String()
};
const text = Type.String();
const attributes = object({
  type: text,
  aliases: Type.Array(text),
  tags: Type.Array(text),
  cover: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
});
/** 作者保存可带资料属性；Agent 写入不接受属性。 */
const authorDocumentInput = { ...documentInput, attributes: Type.Optional(attributes) };
const entryInput = {
  commandId: id,
  workId: id,
  parentId,
  title: Type.String(),
  section: Type.Union([Type.Literal('manuscript'), Type.Literal('resource')])
};
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
const recordFields = {
  resourceIds: Type.Array(id, { minItems: 1 }),
  text: Type.String(),
  source: Type.Union([
    object({ kind: Type.Literal('chapter'), chapterId: id, revisionId: id }),
    object({ kind: Type.Literal('author') })
  ]),
  placement: Type.Union([
    object({ kind: Type.Literal('chapter'), chapterId: id }),
    object({ kind: Type.Literal('opening') }),
    object({ kind: Type.Literal('undetermined') })
  ]),
  storyTime: Type.String()
};
const pair = Type.Tuple([Type.String(), Type.String()]);
const milestone = object({
  id: parentId,
  kind: Type.Union([Type.Literal('start'), Type.Literal('end')]),
  source: recordFields.source,
  placement: recordFields.placement,
  storyTime: Type.String()
});
const relationFields = {
  resourceIds: Type.Tuple([id, id]),
  type: Type.String(),
  directed: Type.Boolean(),
  titles: pair,
  milestones: Type.Array(milestone)
};
const createRelation = { commandId: id, workId: id, ...relationFields };
const updateRelation = { commandId: id, workId: id, relationId: id, expectedRevisionId: id, ...relationFields };
const removeRelation = { commandId: id, workId: id, relationId: id, expectedRevisionId: id };
const createRecord = { commandId: id, workId: id, ...recordFields };
const updateRecord = { commandId: id, workId: id, recordId: id, expectedRevisionId: id, ...recordFields };
const removeRecord = { commandId: id, workId: id, recordId: id, expectedRevisionId: id };
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
  saveDocument: object({ commandId: id, ...authorDocumentInput }),
  readDocument: object(documentTarget),
  renameEntry: object({ commandId: id, workId: id, entryId: id, expectedRevisionId: id, title: Type.String() }),
  moveEntry: object({
    commandId: id,
    workId: id,
    entryId: id,
    expectedParentId: parentId,
    expectedPosition: offset,
    parentId,
    beforeEntryId: parentId
  }),
  createRecord: object(createRecord),
  updateRecord: object(updateRecord),
  moveRecord: object({ commandId: id, workId: id, recordId: id, beforeId: parentId }),
  removeRecord: object(removeRecord),
  listSourceReviews: object({ workId: id }),
  confirmChapter: object({ commandId: id, workId: id, chapterId: id, revisionId: id }),
  createRelation: object(createRelation),
  updateRelation: object(updateRelation),
  removeRelation: object(removeRelation),
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
  writeDraft: object({ ...authorDocumentInput, draftId: id, expectedDraftVersion: parentId }),
  discardDraft: object({ ...documentTarget, draftId: id }),
  readDraftState: object(documentTarget),
  readRevision: object({ workId: id, revisionId: id }),
  listRevisions: object(documentTarget),
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
  }),
  updateRecordReview: object({ ...reviewTarget, ...recordFields, commandId: id, resolveConflicts: Type.Boolean() }),
  updateRelationReview: object({
    ...reviewTarget,
    ...relationFields,
    commandId: id,
    resolveConflicts: Type.Boolean()
  }),
  relinkResource: object({ commandId: id, changeId: id, expectedVersion: id, resourceId: id })
} satisfies Record<keyof CreationAuthorCommands, TSchema>;

export const agentInputs = {
  listWorks: inputs.listWorks,
  listEntries: inputs.listEntries,
  readDocument: inputs.readDocument,
  searchDocuments: inputs.searchDocuments,
  createEntry: inputs.createEntry,
  writeDocument: object({ commandId: id, ...documentInput }),
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
  }),
  listRecords: object({ workId: id, resourceId: parentId, sourceId: parentId, asOf: parentId }),
  createRecord: object({ ...createRecord, basis: Type.String() }),
  updateRecord: object({ ...updateRecord, basis: Type.String() }),
  removeRecord: object({ ...removeRecord, basis: Type.String() }),
  listRelations: object({ workId: id, resourceId: parentId, asOf: parentId }),
  createRelation: object({ ...createRelation, basis: Type.String() }),
  updateRelation: object({
    commandId: id,
    workId: id,
    relationId: id,
    expectedRevisionId: id,
    resourceIds: Type.Optional(relationFields.resourceIds),
    type: Type.Optional(relationFields.type),
    directed: Type.Optional(relationFields.directed),
    titles: Type.Optional(pair),
    milestones: Type.Array(Type.Union([milestone, object({ id, remove: Type.Literal(true) })])),
    basis: Type.String()
  }),
  removeRelation: object({ ...removeRelation, basis: Type.String() })
} satisfies Record<keyof CreationAgentCommands, TSchema>;

function commands(schemas: Record<string, TSchema>) {
  return Compile(
    Type.Union(Object.entries(schemas).map(([method, input]) => object({ method: Type.Literal(method), input })))
  );
}
export const authorValidator = commands(inputs);
export const agentValidator = commands(agentInputs);
