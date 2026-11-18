<script setup lang="ts">
import { computed, ref } from 'vue';

import { groupByPlacement, type RecordChange, type RecordFields, type StoryRecord } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { requestCreation, useCreationStore } from '@/features/creation';

import DraftSourceHint from './DraftSourceHint.vue';
import { chapterTitles, placementLabel, placementValue, resourceTitle, sourceLabel, type MilestoneRow } from './labels';
import RecordForm from './RecordForm.vue';
import StorySection from './StorySection.vue';
import { useStoryCommand } from './use-story-command';

/**
 * 资料涉及的事件，按发生位置分组；关系的建立与结束排在同一位置的事件之后，标“关系变化”。
 * 传入 candidates 时为审阅视图：本会话候选穿插在正式事件中逐条处理，正式事件只读；
 * 否则作者可逐条新增、修改、调整顺序和删除，每条单独保存。
 */
const props = defineProps<{
  workId: string;
  resourceId: string;
  /** 查看到的章节，null 为全部。 */
  asOf: string | null;
  milestones: MilestoneRow[];
  candidates?: RecordChange[];
  /** 须先处理本章正文的候选 ID 到待审正文所在章节。 */
  waiting?: ReadonlyMap<string, string[]>;
  busy?: boolean;
  /** 出处章节正文核对后改过的事件与建立／结束 ID。 */
  changedSources: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  decide: [change: RecordChange, decision: 'accept' | 'reject'];
  update: [change: RecordChange, fields: RecordFields];
  locate: [relationId: string];
  /** 打开出处章节的审阅。 */
  source: [chapterId: string];
}>();
const creation = useCreationStore();
const adding = ref(false);
const editingId = ref<string | null>(null);
const reviewing = computed(() => props.candidates !== undefined);
const { error, locked, run } = useStoryCommand(() => props.busy);

const formal = computed(() => creation.records.filter(record => record.resourceIds.includes(props.resourceId)));
const changes = computed(() => new Map((props.candidates ?? []).map(change => [change.targetId, change])));
/** 候选按正式事件的顺序显示；新事件排在所属位置末尾。 */
const items = computed<StoryRecord[]>(() => [
  ...formal.value.filter(record => !changes.value.has(record.id)),
  ...[...changes.value.values()].map(change => {
    const current = creation.records.find(record => record.id === change.targetId);
    return {
      ...change.candidate,
      position: current?.position ?? Number.MAX_SAFE_INTEGER,
      revisionId: current?.revisionId ?? '',
      createdAt: 0,
      updatedAt: 0
    };
  })
]);
type Row = { kind: 'record'; record: StoryRecord } | { kind: 'milestone'; milestone: MilestoneRow };
const groups = computed(() => {
  const records = items.value.toSorted((a, b) => a.position - b.position);
  const rows = [
    ...records.map(record => ({ kind: 'record' as const, record, placement: record.placement })),
    ...props.milestones.map(milestone => ({ kind: 'milestone' as const, milestone, placement: milestone.placement }))
  ];
  return groupByPlacement<Row & { placement: StoryRecord['placement'] }>(rows, creation.entries, props.asOf).map(
    group => ({
      placement: group.placement,
      rows: group.items,
      records: group.items.flatMap(row => (row.kind === 'record' ? [row.record] : []))
    })
  );
});
const pendingCount = computed(() => props.candidates?.length ?? 0);

/** 同一事件涉及的其他资料。 */
function others(record: { resourceIds: string[] }) {
  return record.resourceIds
    .filter(id => id !== props.resourceId)
    .map(id => resourceTitle(id, creation.entries, creation.pendingEntries) ?? '已删除的资料')
    .join('、');
}
function changeLabel(change: RecordChange) {
  if (change.deleted) return '移除';
  if (change.base === null) return '新增';
  return change.candidate.resourceIds.includes(props.resourceId) ? '修改' : '不再涉及本资料';
}
function original(change: RecordChange) {
  const base = change.base;
  if (!base || change.deleted) return '';
  const candidate = change.candidate;
  return [
    placementValue(base.placement) !== placementValue(candidate.placement)
      ? `发生在${placementLabel(base.placement, creation.entries)}`
      : '',
    base.storyTime !== candidate.storyTime ? `时间 ${base.storyTime || '未标注'}` : ''
  ]
    .filter(Boolean)
    .join('，');
}
function newFields(): RecordFields {
  return {
    resourceIds: [props.resourceId],
    text: '',
    source: { kind: 'author' },
    placement: props.asOf === null ? { kind: 'undetermined' } : { kind: 'chapter', chapterId: props.asOf },
    storyTime: ''
  };
}
function fieldsOf(record: StoryRecord): RecordFields {
  return {
    resourceIds: record.resourceIds,
    text: record.text,
    source: record.source,
    placement: record.placement,
    storyTime: record.storyTime
  };
}

async function create(fields: RecordFields) {
  if (
    await run(() =>
      requestCreation('createRecord', { commandId: crypto.randomUUID(), workId: props.workId, ...fields })
    )
  )
    adding.value = false;
}
async function save(record: StoryRecord, fields: RecordFields) {
  const change = changes.value.get(record.id);
  if (change) {
    emit('update', change, fields);
    editingId.value = null;
    return;
  }
  const done = await run(() =>
    requestCreation('updateRecord', {
      commandId: crypto.randomUUID(),
      workId: props.workId,
      recordId: record.id,
      expectedRevisionId: record.revisionId,
      ...fields
    })
  );
  if (done) editingId.value = null;
}
function remove(record: StoryRecord) {
  return run(() =>
    requestCreation('removeRecord', {
      commandId: crypto.randomUUID(),
      workId: props.workId,
      recordId: record.id,
      expectedRevisionId: record.revisionId
    })
  );
}
/** 顺序按全作品同一位置编号；在本资料的子序列中上移或下移，即插到相邻事件之前或之后。 */
function move(record: StoryRecord, records: StoryRecord[], step: -1 | 1) {
  const index = records.indexOf(record);
  const neighbor = records[index + step];
  const all = creation.records
    .filter(item => placementValue(item.placement) === placementValue(record.placement))
    .toSorted((a, b) => a.position - b.position);
  const beforeId = step === -1 ? neighbor.id : (all[all.indexOf(neighbor) + 1]?.id ?? null);
  return run(() =>
    requestCreation('moveRecord', {
      commandId: crypto.randomUUID(),
      workId: props.workId,
      recordId: record.id,
      beforeId
    })
  );
}
</script>

<template>
  <StorySection
    title="事件"
    :count="formal.length"
    :pending="pendingCount"
    :add-label="reviewing ? undefined : '事件'"
    :add-disabled="adding"
    @add="adding = true"
  >
    <p v-if="error" class="records-error" role="alert">{{ error }}</p>
    <RecordForm
      v-if="adding"
      :initial="newFields()"
      :busy="locked"
      submit-label="保存"
      @submit="create"
      @cancel="adding = false"
    />
    <p v-if="!groups.length && !adding" class="records-empty">
      {{ asOf === null ? '还没有事件' : '截至这一章还没有事件' }}
    </p>
    <section v-for="group in groups" :key="placementValue(group.placement)">
      <h4 class="records-group-title">{{ placementLabel(group.placement, creation.entries) }}</h4>
      <ul class="records-list">
        <template v-for="row in group.rows" :key="row.kind === 'record' ? row.record.id : row.milestone.key">
          <li v-if="row.kind === 'milestone'" class="record">
            <button type="button" class="record-locate" @click="emit('locate', row.milestone.relationId)">
              <span class="record-change">关系变化</span>
              <span class="record-text">{{ row.milestone.text }}</span>
              <span v-if="row.milestone.pending" class="record-hint">待接受</span>
            </button>
            <p v-if="row.milestone.storyTime" class="record-meta">{{ row.milestone.storyTime }}</p>
          </li>
          <li
            v-else
            class="record"
            :class="{ 'record-pending': changes.has(row.record.id), 'record-editing': editingId === row.record.id }"
          >
            <RecordForm
              v-if="editingId === row.record.id"
              :initial="fieldsOf(row.record)"
              :busy="locked"
              :submit-label="changes.has(row.record.id) ? '保存修改' : '保存'"
              @submit="fields => save(row.record, fields)"
              @cancel="editingId = null"
            />
            <template v-else-if="changes.get(row.record.id)">
              <div class="record-main">
                <span class="record-badge">{{ changeLabel(changes.get(row.record.id)!) }}</span>
                <span class="record-text" :class="{ 'record-removed': changes.get(row.record.id)!.deleted }">
                  <del
                    v-if="
                      changes.get(row.record.id)!.base && changes.get(row.record.id)!.base!.text !== row.record.text
                    "
                    >{{ changes.get(row.record.id)!.base!.text }}</del
                  >
                  {{ row.record.text }}
                </span>
              </div>
              <p class="record-meta">
                {{
                  [
                    row.record.storyTime,
                    sourceLabel(row.record.source, creation.entries, changedSources.has(row.record.id)),
                    others(row.record) && `涉及${others(row.record)}`
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </p>
              <p v-if="original(changes.get(row.record.id)!)" class="record-meta">
                原：{{ original(changes.get(row.record.id)!) }}
              </p>
              <p v-if="changes.get(row.record.id)!.basis" class="record-basis">
                依据：{{ changes.get(row.record.id)!.basis }}
              </p>
              <DraftSourceHint
                v-if="waiting?.has(changes.get(row.record.id)!.id)"
                :chapter-ids="waiting.get(changes.get(row.record.id)!.id)!"
                @open="id => emit('source', id)"
              />
              <p v-if="changes.get(row.record.id)!.conflicts.length" class="record-conflict" role="status">
                Agent 修改期间正式事件也有变化，检查后修改并保存即视为已解决。
              </p>
              <div class="record-actions">
                <AppButton
                  size="xs"
                  variant="ghost"
                  :disabled="locked"
                  @click="emit('decide', changes.get(row.record.id)!, 'reject')"
                  >拒绝</AppButton
                >
                <AppButton
                  v-if="!changes.get(row.record.id)!.deleted"
                  size="xs"
                  variant="ghost"
                  :disabled="locked"
                  @click="editingId = row.record.id"
                  >修改</AppButton
                >
                <AppButton
                  size="xs"
                  variant="primary"
                  :disabled="
                    locked ||
                    changes.get(row.record.id)!.conflicts.length > 0 ||
                    waiting?.has(changes.get(row.record.id)!.id)
                  "
                  :title="
                    changes.get(row.record.id)!.conflicts.length
                      ? '请先处理冲突'
                      : waiting?.has(changes.get(row.record.id)!.id)
                        ? `先处理${chapterTitles(waiting.get(changes.get(row.record.id)!.id)!, creation.entries, creation.pendingEntries)}`
                        : undefined
                  "
                  @click="emit('decide', changes.get(row.record.id)!, 'accept')"
                  >接受</AppButton
                >
              </div>
            </template>
            <template v-else>
              <div class="record-main">
                <span class="record-text">{{ row.record.text }}</span>
                <span v-if="!reviewing" class="record-tools">
                  <AppTooltip text="修改">
                    <button
                      type="button"
                      class="record-tool"
                      :disabled="locked"
                      aria-label="修改"
                      @click="editingId = row.record.id"
                    >
                      <span class="i-mingcute-edit-2-line size-3.5" aria-hidden="true" />
                    </button>
                  </AppTooltip>
                  <AppTooltip text="上移">
                    <button
                      type="button"
                      class="record-tool"
                      :disabled="locked || group.records.indexOf(row.record) === 0"
                      aria-label="上移"
                      @click="move(row.record, group.records, -1)"
                    >
                      <span class="i-mingcute-arrow-up-line size-3.5" aria-hidden="true" />
                    </button>
                  </AppTooltip>
                  <AppTooltip text="下移">
                    <button
                      type="button"
                      class="record-tool"
                      :disabled="locked || group.records.indexOf(row.record) === group.records.length - 1"
                      aria-label="下移"
                      @click="move(row.record, group.records, 1)"
                    >
                      <span class="i-mingcute-arrow-down-line size-3.5" aria-hidden="true" />
                    </button>
                  </AppTooltip>
                  <AppTooltip text="删除，可在回收站恢复">
                    <button
                      type="button"
                      class="record-tool"
                      :disabled="locked"
                      aria-label="删除"
                      @click="remove(row.record)"
                    >
                      <span class="i-mingcute-delete-2-line size-3.5" aria-hidden="true" />
                    </button>
                  </AppTooltip>
                </span>
              </div>
              <p class="record-meta">
                {{
                  [
                    row.record.storyTime,
                    sourceLabel(row.record.source, creation.entries, changedSources.has(row.record.id)),
                    others(row.record) && `涉及${others(row.record)}`
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </p>
            </template>
          </li>
        </template>
      </ul>
    </section>
  </StorySection>
</template>

<style scoped>
.records-empty {
  margin: 4px 0 0 60px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.records-error {
  margin: 0;
  padding: 4px 0 4px 60px;
  color: var(--destructive);
  font-size: var(--ui-caption-size);
}
.records-group-title {
  margin: 10px 0 2px 24px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-weight: 500;
}
.records-list {
  margin: 0 0 0 52px;
  padding: 0;
  list-style: none;
}
.record {
  padding: 4px 8px;
  border-radius: var(--radius-control-sm);
}
.record:hover {
  background: var(--surface-hover);
}
/* 修改时表单回到与资料属性相同的网格位置。 */
.record.record-editing {
  padding: 0;
  border-left: 0;
  background: none;
}
.record-editing :deep(.record-form) {
  margin-left: -52px;
}
.record-locate {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  text-align: left;
}
.record-change {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: var(--surface-muted);
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
.record-hint {
  flex-shrink: 0;
  color: var(--warning);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
.record-pending {
  border-left: 2px solid var(--warning);
  background: color-mix(in srgb, var(--warning) 6%, transparent);
}
.record-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.record-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.record-text del {
  color: var(--muted-foreground);
}
.record-removed {
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--destructive) 60%, transparent);
}
.record-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
.record-tools {
  display: flex;
  gap: 2px;
  visibility: hidden;
}
.record:hover .record-tools,
.record:focus-within .record-tools {
  visibility: visible;
}
.record-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-control-sm);
  color: var(--muted-foreground);
}
.record-tool:hover:not(:disabled) {
  background: var(--surface-muted);
  color: var(--foreground);
}
.record-tool:disabled {
  opacity: 0.4;
}
.record-meta,
.record-basis {
  margin: 2px 0 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.record-basis {
  font-style: italic;
}
.record-conflict {
  margin: 4px 0 0;
  font-size: var(--ui-caption-size);
}
.record-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}
</style>
