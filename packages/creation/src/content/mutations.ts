import { randomUUID } from 'node:crypto';

import type {
  CreateEntryInput,
  Document,
  Entry,
  EntrySnapshot,
  MoveEntryInput,
  RenameEntryInput,
  SaveDocumentInput
} from '../contracts/content.ts';
import { assertNotTrashed, EntryLocationConflictError, RevisionConflictError } from '../errors.ts';
import type { WorkRepository } from '../repository.ts';
import { countDocumentWords } from '../text.ts';
import { revisionFor } from './commit.ts';
import { assertCover, assertEntryParent, initialAttributes } from './entries.ts';

/** 调用方已进入作品事务；这里集中维护正式内容的领域约束。 */
export function createEntry(work: WorkRepository, input: CreateEntryInput): Entry {
  const now = Date.now();
  const content = input.kind === 'document' ? input.content : null;
  const entry: Entry = {
    id: randomUUID(),
    parentId: input.parentId,
    section: input.section,
    kind: input.kind,
    title: input.title,
    position: work.nextPosition(input.section, input.parentId),
    format: input.kind === 'document' ? input.format : null,
    fileName: null,
    wordCount: content === null ? 0 : countDocumentWords(content),
    revisionId: randomUUID(),
    createdAt: now,
    updatedAt: now
  };
  assertEntryParent(work.listEntries(), entry);
  const snapshot = { ...entry, content, attributes: initialAttributes(entry) };
  work.insertEntry(snapshot, revisionFor(snapshot, null));
  return entry;
}

/** 文件已复制到条目目录后登记文件条目；文件条目只在资料区。 */
export function insertFileEntry(
  work: WorkRepository,
  input: { parentId: string | null; entryId: string; fileName: string }
): Entry {
  const now = Date.now();
  const entry: Entry = {
    id: input.entryId,
    parentId: input.parentId,
    section: 'resource',
    kind: 'file',
    title: input.fileName,
    position: work.nextPosition('resource', input.parentId),
    format: null,
    fileName: input.fileName,
    wordCount: 0,
    revisionId: randomUUID(),
    createdAt: now,
    updatedAt: now
  };
  assertEntryParent(work.listEntries(), entry);
  const snapshot = { ...entry, content: null, attributes: null };
  work.insertEntry(snapshot, revisionFor(snapshot, null));
  return entry;
}

export function renameEntry(work: WorkRepository, input: RenameEntryInput): Entry {
  const current = work.getEntry(input.entryId);
  if (!current) assertNotTrashed(work, input.entryId);
  if (!current || current.kind === 'document') throw new Error('目录或文件不存在');
  if (current.revisionId !== input.expectedRevisionId)
    throw new RevisionConflictError(input.expectedRevisionId, current.revisionId);
  if (current.title === input.title) return current;
  const saved = { ...current, title: input.title, revisionId: randomUUID(), updatedAt: Date.now() };
  const snapshot = { ...saved, content: null, attributes: null };
  work.updateTitle(snapshot, revisionFor(snapshot, current.revisionId));
  return saved;
}

export function moveEntry(work: WorkRepository, input: MoveEntryInput): Entry {
  const { entryId, parentId, beforeEntryId } = input;
  const entry = work.getEntry(entryId);
  if (!entry) assertNotTrashed(work, entryId);
  if (!entry) throw new Error('条目不存在');
  if (entry.parentId !== input.expectedParentId || entry.position !== input.expectedPosition)
    throw new EntryLocationConflictError(entry.parentId, entry.position);
  assertEntryParent(work.listEntries(), { ...entry, parentId });
  const sameParent = entry.parentId === parentId;
  let position: number;
  if (beforeEntryId === null) position = work.nextPosition(entry.section, parentId) - (sameParent ? 1 : 0);
  else {
    const before = work.getEntry(beforeEntryId);
    if (!before || before.parentId !== parentId || before.section !== entry.section)
      throw new Error('排序目标不存在或不属于目标目录');
    position = before.position - (sameParent && entry.position < before.position ? 1 : 0);
  }
  if (sameParent && entry.position === position) return entry;
  work.relocateEntry(entry, parentId, position);
  return { ...entry, parentId, position };
}

export function saveDocument(work: WorkRepository, input: SaveDocumentInput): Entry {
  const current = readDocument(work, input.documentId);
  if (current.revisionId !== input.expectedRevisionId)
    throw new RevisionConflictError(input.expectedRevisionId, current.revisionId);
  if (current.attributes === null && input.attributes) throw new Error('文稿没有属性');
  const attributes = input.attributes ?? current.attributes;
  if (attributes) assertCover(work.listEntries(), attributes.cover, current.attributes!.cover);
  const { content: currentContent, attributes: currentAttributes, ...metadata } = current;
  if (
    metadata.title === input.title &&
    metadata.format === input.format &&
    currentContent === input.content &&
    JSON.stringify(currentAttributes) === JSON.stringify(attributes)
  )
    return metadata;
  const saved: Document = {
    ...current,
    title: input.title,
    format: input.format,
    content: input.content,
    attributes,
    wordCount: countDocumentWords(input.content),
    revisionId: randomUUID(),
    updatedAt: Date.now()
  };
  work.updateDocument(saved, revisionFor(saved, current.revisionId));
  const { content: _content, attributes: _attributes, ...entry } = saved;
  return entry;
}

export function saveParameters(input: Omit<SaveDocumentInput, 'commandId'>): readonly unknown[] {
  return [
    'saveDocument',
    input.workId,
    input.documentId,
    input.expectedRevisionId,
    input.title,
    input.format,
    input.content,
    JSON.stringify(input.attributes ?? null)
  ];
}

export function readEntrySnapshot(work: WorkRepository, entryId: string): EntrySnapshot | null {
  const entry = work.getEntry(entryId);
  if (!entry) return null;
  if (entry.kind !== 'document') return { ...entry, content: null, attributes: null };
  const { content, attributes } = readDocument(work, entryId);
  return { ...entry, content, attributes };
}

export function readDocument(work: WorkRepository, documentId: string): Document {
  const document = work.getDocument(documentId);
  if (!document) assertNotTrashed(work, documentId);
  if (!document) throw new Error('文稿或资料不存在');
  return document;
}
