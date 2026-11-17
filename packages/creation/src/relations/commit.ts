import { randomUUID } from 'node:crypto';

import type { Entry, Revision } from '../contracts/content.ts';
import {
  relationPresets,
  type RelationFields,
  type RelationInput,
  type RelationSnapshot,
  type StoryRelation
} from '../contracts/relations.ts';
import { assertLocation, isResource } from '../records/commit.ts';
import type { WorkRepository } from '../repository.ts';

/** 在调用方已开启的作品事务中写入关系快照：复核基线、引用与类型方向（对照正式关系）并生成修订。 */
export function applyRelationSnapshot(
  work: WorkRepository,
  input: { base: StoryRelation | null; candidate: RelationSnapshot; source: Revision['source'] }
): StoryRelation {
  const { base, candidate, source } = input;
  const current = work.getRelation(candidate.id);
  if (
    base === null
      ? current !== undefined || work.isRelationTrashed(candidate.id)
      : current?.revisionId !== base.revisionId
  )
    throw new Error('正式内容已有变化，请刷新审阅内容');
  const snapshot = normalizeRelation(candidate);
  assertRelation(work, snapshot, base, work.listEntries(), work.listRelations());
  return work.saveRelation(snapshot, {
    id: randomUUID(),
    relationId: snapshot.id,
    parentRevisionId: base?.revisionId ?? null,
    source,
    snapshot,
    createdAt: Date.now()
  });
}

export function normalizeRelation<T extends RelationFields | RelationInput>(fields: T): T {
  return {
    ...fields,
    type: fields.type.trim(),
    titles: [fields.titles[0].trim(), fields.titles[1].trim()],
    milestones: fields.milestones.map(milestone => ({ ...milestone, storyTime: milestone.storyTime.trim() }))
  };
}

/** 为新增的建立／结束分配 ID；已有 ID 须属于 previous。 */
export function buildRelationSnapshot(
  id: string,
  input: RelationInput,
  previous: Pick<RelationFields, 'milestones'> | null
): RelationSnapshot {
  const { resourceIds, type, directed, titles } = input;
  const milestones = input.milestones.map(milestone => {
    if (milestone.id !== null && !previous?.milestones.some(item => item.id === milestone.id))
      throw new Error('要修改的建立或结束不存在');
    return { ...milestone, id: milestone.id ?? randomUUID() };
  });
  return normalizeRelation({ id, resourceIds: [...resourceIds], type, directed, titles: [...titles], milestones });
}

/**
 * 双方须为两份不同的资料，至少一条建立（含回收站中的）；同名类型的方向与预设及本作品其他关系一致。
 * 修改时沿用已失效的资料与章节引用不再校验。entries 为可见目录，审阅模式含本会话候选。
 */
export function assertRelation(
  work: WorkRepository,
  fields: RelationSnapshot,
  previous: RelationFields | null,
  entries: readonly Entry[],
  others: readonly RelationSnapshot[]
): void {
  assertRelationShape(fields, work.hasTrashedStart(fields.id));
  for (const id of fields.resourceIds)
    if (!previous?.resourceIds.includes(id) && !isResource(entries, id))
      throw new Error('关系涉及的资料不存在或不是资料文档');
  for (const milestone of fields.milestones)
    assertLocation(work, milestone, previous?.milestones.find(item => item.id === milestone.id) ?? null, entries);
  const used = [...relationPresets, ...others.filter(other => other.id !== fields.id)].find(
    other => other.type === fields.type
  );
  if (used && used.directed !== fields.directed)
    throw new Error(`关系类型“${fields.type}”在本作品中${used.directed ? '有方向' : '无方向'}，请保持一致`);
}

/** 不涉及引用的规则；作者手改候选时先行检查，引用在接受时校验。随出处章节进入回收站的建立仍算作已有建立。 */
export function assertRelationShape(fields: RelationSnapshot, trashedStart: boolean): void {
  if (fields.resourceIds[0] === fields.resourceIds[1]) throw new Error('关系双方不能是同一份资料');
  if (!fields.type) throw new Error('关系类型不能为空');
  if (!fields.titles[0] || !fields.titles[1]) throw new Error('两端称呼不能为空');
  if (!trashedStart && !fields.milestones.some(milestone => milestone.kind === 'start'))
    throw new Error('关系至少要有一条建立');
  if (new Set(fields.milestones.map(milestone => milestone.id)).size !== fields.milestones.length)
    throw new Error('建立或结束不能重复');
}
