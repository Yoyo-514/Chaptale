import { asRecord, asRecords, entryTarget, listContent, writeStatusLabel } from './shared';
import type { EntryLookup, JsonRecord, ToolDetailContent, ToolDetailItem, WorkToolCall } from './types';

function formatPlacement(placement: unknown, lookup?: EntryLookup): string | undefined {
  if (placement === 'opening') return '开篇之前';
  if (placement === 'undetermined') return '位置待定';
  if (typeof placement === 'string' && placement) {
    const entry = lookup?.(placement);
    return entry ? `发生于《${entry.title}》` : undefined;
  }
  const obj = asRecord(placement);
  if (!obj) return undefined;
  if (obj.kind === 'opening') return '开篇之前';
  if (obj.kind === 'undetermined') return '位置待定';
  if (obj.kind === 'chapter' && typeof obj.chapterId === 'string') {
    const entry = lookup?.(obj.chapterId);
    return entry ? `发生于《${entry.title}》` : undefined;
  }
  return undefined;
}

function resourceNames(resourceIds: unknown[], lookup: EntryLookup): string[] {
  return resourceIds
    .map(id => (typeof id === 'string' ? lookup(id)?.title : undefined))
    .filter((name): name is string => Boolean(name));
}

/** 两端称谓不同时写成“（甲 / 乙）”。 */
function rolePair(titles: unknown[]): string {
  return typeof titles[0] === 'string' && typeof titles[1] === 'string' && titles[0] !== titles[1]
    ? `（${titles[0]} / ${titles[1]}）`
    : '';
}

/** 关系两端都是可打开的资料时给出一对跳转目标。 */
function relationEnds(resourceIds: unknown[], lookup?: EntryLookup) {
  const left = typeof resourceIds[0] === 'string' && lookup ? lookup(resourceIds[0]) : undefined;
  const right = typeof resourceIds[1] === 'string' && lookup ? lookup(resourceIds[1]) : undefined;
  const pair =
    left?.kind === 'document' && right?.kind === 'document'
      ? { target: entryTarget(left), secondaryTarget: entryTarget(right) }
      : undefined;
  return { left, right, pair };
}

/** 一条事件：文本，附涉及资料、发生位置与故事时间。 */
export function recordItem(rec: JsonRecord, idx: number, lookup?: EntryLookup): ToolDetailItem {
  const parts: string[] = [];
  if (Array.isArray(rec.resourceIds) && lookup) {
    const names = resourceNames(rec.resourceIds, lookup);
    if (names.length) parts.push(names.join('、'));
  }
  const place = formatPlacement(rec.placement, lookup);
  if (place) parts.push(place);
  if (typeof rec.storyTime === 'string' && rec.storyTime) parts.push(rec.storyTime);
  if (rec.pending === true) parts.push('待审');
  if (rec.sourceChanged === true) parts.push('出处已更新');
  return {
    key: typeof rec.recordId === 'string' ? rec.recordId : String(idx),
    label: typeof rec.text === 'string' ? rec.text : '',
    ...(parts.length && { meta: parts.join(' · ') })
  };
}

/** work_record_ls：事件列表。 */
export function recordListDetail({ value, lookup }: WorkToolCall): ToolDetailContent {
  if (!Array.isArray(value)) return { meta: [] };
  return listContent(
    [],
    asRecords(value).map((rec, idx) => recordItem(rec, idx, lookup)),
    '暂无事件记录'
  );
}

/** work_record_write：写入的事件及其依据。 */
export function recordWriteDetail({ input, value, lookup }: WorkToolCall): ToolDetailContent {
  const meta: string[] = [];
  const res = asRecord(value);
  const rec = asRecord(res?.record);
  const status = writeStatusLabel(res?.kind, rec?.pending);
  if (status) meta.push(status);
  const resourceIds = Array.isArray(rec?.resourceIds)
    ? rec.resourceIds
    : Array.isArray(input?.resourceIds)
      ? input.resourceIds
      : [];
  if (resourceIds.length && lookup) {
    const names = resourceNames(resourceIds, lookup);
    if (names.length) meta.push(`涉及：${names.join('、')}`);
  }
  const place = formatPlacement(rec?.placement ?? input?.placement, lookup);
  if (place) meta.push(place);
  const storyTime = typeof rec?.storyTime === 'string' ? rec.storyTime : input?.storyTime;
  if (typeof storyTime === 'string' && storyTime) meta.push(storyTime);
  const body = typeof rec?.text === 'string' ? rec.text : typeof input?.text === 'string' ? input.text : undefined;
  const basis = typeof input?.basis === 'string' && input.basis ? input.basis : undefined;
  return { meta, ...(body && { body }), ...(basis && { basis }) };
}

/** 一条关系：双方资料，附类型、两端称呼与是否持续。 */
export function relationItem(rel: JsonRecord, idx: number, lookup?: EntryLookup): ToolDetailItem {
  const { left, right, pair } = relationEnds(Array.isArray(rel.resourceIds) ? rel.resourceIds : [], lookup);
  const connector = rel.directed === false ? '↔' : '→';
  const typeText = typeof rel.type === 'string' ? rel.type : '关系';
  const parts = [`${typeText}${rolePair(Array.isArray(rel.titles) ? rel.titles : [])}`];
  if (rel.state === 'active') parts.push('持续中');
  else if (rel.state === 'ended') parts.push('已结束');
  if (rel.pending === true) parts.push('待审');
  const key = typeof rel.relationId === 'string' ? rel.relationId : String(idx);
  if (pair)
    return { key, target: pair.target, connector, secondaryTarget: pair.secondaryTarget, meta: parts.join(' · ') };
  return {
    key,
    label: left || right ? `《${left?.title ?? '资料'}》 ${connector} 《${right?.title ?? '资料'}》` : typeText,
    meta: parts.join(' · ')
  };
}

/** work_relation_ls：关系列表。 */
export function relationListDetail({ value, lookup }: WorkToolCall): ToolDetailContent {
  const res = asRecord(value);
  if (!Array.isArray(res?.relations)) return { meta: [] };
  return listContent(
    [],
    asRecords(res.relations).map((rel, idx) => relationItem(rel, idx, lookup)),
    '暂无关系记录'
  );
}

/** work_relation_write：写入的关系及其依据。 */
export function relationWriteDetail({ input, value, lookup }: WorkToolCall): ToolDetailContent {
  const meta: string[] = [];
  const res = asRecord(value);
  const rel = asRecord(res?.relation);
  const status = writeStatusLabel(res?.kind, rel?.pending);
  if (status) meta.push(status);
  const relType = typeof rel?.type === 'string' ? rel.type : typeof input?.type === 'string' ? input.type : '';
  const titles = Array.isArray(rel?.titles) ? rel.titles : Array.isArray(input?.titles) ? input.titles : [];
  if (relType) meta.push(`${relType}${rolePair(titles)}`);
  const ids = Array.isArray(rel?.resourceIds)
    ? rel.resourceIds
    : Array.isArray(input?.resourceIds)
      ? input.resourceIds
      : [];
  const { pair } = relationEnds(ids, lookup);
  const connector = (rel?.directed ?? input?.directed) === false ? '↔' : '→';
  const basis = typeof input?.basis === 'string' && input.basis ? input.basis : undefined;
  return {
    meta,
    ...(pair && { items: [{ key: 'pair', target: pair.target, connector, secondaryTarget: pair.secondaryTarget }] }),
    ...(basis && { basis })
  };
}
