import { randomUUID } from 'node:crypto';

import type { Entry, Revision } from '../contracts/content.ts';
import type { RecordFields, RecordPlacement, RecordSnapshot, StoryRecord } from '../contracts/records.ts';
import type { WorkRepository } from '../repository.ts';

/** 在调用方已开启的作品事务中写入事件快照：复核基线与引用并生成修订；多份快照可共用同一事务和回执。 */
export function applyRecordSnapshot(
  work: WorkRepository,
  input: { base: StoryRecord | null; candidate: RecordSnapshot; source: Revision['source'] }
): StoryRecord {
  const { base, candidate, source } = input;
  const current = work.getRecord(candidate.id);
  if (
    base === null
      ? current !== undefined || work.isRecordTrashed(candidate.id)
      : current?.revisionId !== base.revisionId
  )
    throw new Error('正式内容已有变化，请刷新审阅内容');
  assertRecord(work, candidate, base);
  const snapshot = normalizeRecord(candidate);
  return work.saveRecord(snapshot, {
    id: randomUUID(),
    recordId: snapshot.id,
    parentRevisionId: base?.revisionId ?? null,
    source,
    snapshot,
    createdAt: Date.now()
  });
}

export function normalizeRecord<T extends RecordFields>(fields: T): T {
  return { ...fields, text: fields.text.trim(), storyTime: fields.storyTime.trim() };
}

/** 事件引用的资料、出处与发生章节须存在；修改时沿用已失效的引用不再校验。entries 为可见目录，审阅模式含本会话候选。 */
export function assertRecord(
  work: WorkRepository,
  fields: RecordFields,
  previous: RecordFields | null,
  entries: readonly Entry[] = work.listEntries()
): void {
  if (!fields.text.trim()) throw new Error('事件内容不能为空');
  if (!fields.resourceIds.length) throw new Error('事件至少涉及一份资料');
  if (new Set(fields.resourceIds).size !== fields.resourceIds.length) throw new Error('涉及的资料不能重复');
  for (const id of fields.resourceIds)
    if (!previous?.resourceIds.includes(id) && !isResource(entries, id))
      throw new Error('涉及的资料不存在或不是资料文档');
  assertLocation(work, fields, previous, entries);
}

type Location = Pick<RecordFields, 'source' | 'placement'>;

/** 出处章节与修订、发生章节须存在；沿用 previous 中已失效的引用不再校验。事件与关系的建立／结束共用。 */
export function assertLocation(
  work: WorkRepository,
  fields: Location,
  previous: Location | null,
  entries: readonly Entry[]
): void {
  const { source, placement } = fields;
  if (source.kind === 'chapter' && !sameSource(previous, fields)) {
    if (!isChapter(entries, source.chapterId)) throw new Error('出处章节不存在');
    if (work.getRevisionEntryId(source.revisionId) !== source.chapterId) throw new Error('出处修订不属于该章节');
  }
  if (placement.kind === 'chapter' && !samePlacement(previous?.placement ?? null, placement)) {
    if (!isChapter(entries, placement.chapterId)) throw new Error('发生章节不存在');
  }
}

export function samePlacement(a: RecordPlacement | null, b: RecordPlacement): boolean {
  if (a === null || a.kind !== b.kind) return false;
  return a.kind !== 'chapter' || (b.kind === 'chapter' && a.chapterId === b.chapterId);
}

function sameSource(previous: Location | null, fields: Location): boolean {
  return previous !== null && JSON.stringify(previous.source) === JSON.stringify(fields.source);
}

export function isResource(entries: readonly Entry[], id: string): boolean {
  return entries.some(entry => entry.id === id && entry.section === 'resource' && entry.kind === 'document');
}

function isChapter(entries: readonly Entry[], id: string): boolean {
  return entries.some(entry => entry.id === id && entry.section === 'manuscript' && entry.kind === 'document');
}
