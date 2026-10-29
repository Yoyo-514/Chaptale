<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  chapterOrder,
  groupRecords,
  type RecordChange,
  type RecordFields,
  type StoryRecord
} from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppCollapsible } from '@/components/AppCollapsible';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { requestCreation, useCreationStore } from '@/features/creation';
import { toErrorMessage } from '@/utils/desktop-api';

import { placementLabel, placementValue, sourceLabel } from './labels';
import RecordForm from './RecordForm.vue';

/**
 * 资料涉及的事件，按发生位置分组。传入 candidates 时为审阅视图：本会话候选穿插在正式事件中逐条处理，
 * 正式事件只读；否则作者可逐条新增、修改、调整顺序和删除，每条单独保存。
 */
const props = defineProps<{ workId: string; resourceId: string; candidates?: RecordChange[]; busy?: boolean }>();
const emit = defineEmits<{
  decide: [change: RecordChange, decision: 'accept' | 'reject'];
  update: [change: RecordChange, fields: RecordFields];
}>();
const creation = useCreationStore();
const open = ref(true);
const asOf = ref('all');
const adding = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const error = ref('');
const reviewing = computed(() => props.candidates !== undefined);
const locked = computed(() => saving.value || Boolean(props.busy));

const chapters = computed(() =>
  chapterOrder(creation.entries).map(id => ({ id, title: creation.entries.find(entry => entry.id === id)!.title }))
);
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
const groups = computed(() => groupRecords(items.value, creation.entries, asOf.value === 'all' ? null : asOf.value));
const pendingCount = computed(() => props.candidates?.length ?? 0);

function resourceTitle(id: string) {
  return (
    creation.entries.find(entry => entry.id === id)?.title ??
    creation.pendingEntries.find(change => change.targetId === id)?.candidate.title ??
    '已删除的资料'
  );
}
/** 同一事件涉及的其他资料。 */
function others(record: { resourceIds: string[] }) {
  return record.resourceIds
    .filter(id => id !== props.resourceId)
    .map(resourceTitle)
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
    placement: asOf.value === 'all' ? { kind: 'undetermined' } : { kind: 'chapter', chapterId: asOf.value },
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

async function run(operation: () => Promise<unknown>) {
  if (locked.value) return false;
  saving.value = true;
  error.value = '';
  try {
    await operation();
    return true;
  } catch (cause) {
    error.value = toErrorMessage(cause);
    return false;
  } finally {
    saving.value = false;
  }
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
  <div class="records">
    <AppCollapsible v-model="open" variant="plain" aria-label="事件" role="region">
      <template #trigger>
        <button type="button" class="records-trigger">
          <span
            :class="open ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          <span class="records-title">事件</span>
          <span v-if="pendingCount" class="records-pending">{{ pendingCount }} 条待接受</span>
          <span class="records-count">{{ formal.length ? `${formal.length} 条` : '暂无' }}</span>
        </button>
      </template>
      <div class="records-toolbar">
        <span class="records-label">查看到</span>
        <AppSelect v-model="asOf" class="records-asof" aria-label="查看到">
          <AppSelectItem value="all">全部章节</AppSelectItem>
          <AppSelectItem v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{
            chapter.title
          }}</AppSelectItem>
        </AppSelect>
        <AppButton v-if="!reviewing" size="xs" variant="ghost" :disabled="adding" @click="adding = true">
          <span class="i-mingcute-add-line size-3.5" aria-hidden="true" />添加事件
        </AppButton>
      </div>
      <p v-if="error" class="records-error" role="alert">{{ error }}</p>
      <AppScrollArea class="records-scroll">
        <div class="records-body">
          <RecordForm
            v-if="adding"
            :initial="newFields()"
            :busy="locked"
            submit-label="保存"
            @submit="create"
            @cancel="adding = false"
          />
          <p v-if="!groups.length && !adding" class="records-empty">
            {{ asOf === 'all' ? '还没有事件' : '截至这一章还没有事件' }}
          </p>
          <section v-for="group in groups" :key="placementValue(group.placement)" class="records-group">
            <h4 class="records-group-title">{{ placementLabel(group.placement, creation.entries) }}</h4>
            <ul class="records-list">
              <li
                v-for="record in group.records"
                :key="record.id"
                class="record"
                :class="{ 'record-pending': changes.has(record.id), 'record-editing': editingId === record.id }"
              >
                <RecordForm
                  v-if="editingId === record.id"
                  :initial="fieldsOf(record)"
                  :busy="locked"
                  :submit-label="changes.has(record.id) ? '保存修改' : '保存'"
                  @submit="fields => save(record, fields)"
                  @cancel="editingId = null"
                />
                <template v-else-if="changes.get(record.id)">
                  <div class="record-main">
                    <span class="record-badge">{{ changeLabel(changes.get(record.id)!) }}</span>
                    <span class="record-text" :class="{ 'record-removed': changes.get(record.id)!.deleted }">
                      <del v-if="changes.get(record.id)!.base && changes.get(record.id)!.base!.text !== record.text">{{
                        changes.get(record.id)!.base!.text
                      }}</del>
                      {{ record.text }}
                    </span>
                  </div>
                  <p class="record-meta">
                    {{
                      [
                        record.storyTime,
                        sourceLabel(record.source, creation.entries),
                        others(record) && `涉及${others(record)}`
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    }}
                  </p>
                  <p v-if="original(changes.get(record.id)!)" class="record-meta">
                    原：{{ original(changes.get(record.id)!) }}
                  </p>
                  <p v-if="changes.get(record.id)!.basis" class="record-basis">
                    依据：{{ changes.get(record.id)!.basis }}
                  </p>
                  <p v-if="changes.get(record.id)!.conflicts.length" class="record-conflict" role="status">
                    Agent 修改期间正式事件也有变化，检查后修改并保存即视为已解决。
                  </p>
                  <div class="record-actions">
                    <AppButton
                      size="xs"
                      variant="ghost"
                      :disabled="locked"
                      @click="emit('decide', changes.get(record.id)!, 'reject')"
                      >拒绝</AppButton
                    >
                    <AppButton
                      v-if="!changes.get(record.id)!.deleted"
                      size="xs"
                      variant="ghost"
                      :disabled="locked"
                      @click="editingId = record.id"
                      >修改</AppButton
                    >
                    <AppButton
                      size="xs"
                      variant="primary"
                      :disabled="locked || changes.get(record.id)!.conflicts.length > 0"
                      :title="changes.get(record.id)!.conflicts.length ? '请先处理冲突' : undefined"
                      @click="emit('decide', changes.get(record.id)!, 'accept')"
                      >接受</AppButton
                    >
                  </div>
                </template>
                <template v-else>
                  <div class="record-main">
                    <span class="record-text">{{ record.text }}</span>
                    <span v-if="!reviewing" class="record-tools">
                      <button
                        type="button"
                        class="record-tool"
                        :disabled="locked"
                        aria-label="修改"
                        title="修改"
                        @click="editingId = record.id"
                      >
                        <span class="i-mingcute-edit-2-line size-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="record-tool"
                        :disabled="locked || group.records.indexOf(record) === 0"
                        aria-label="上移"
                        title="上移"
                        @click="move(record, group.records, -1)"
                      >
                        <span class="i-mingcute-arrow-up-line size-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="record-tool"
                        :disabled="locked || group.records.indexOf(record) === group.records.length - 1"
                        aria-label="下移"
                        title="下移"
                        @click="move(record, group.records, 1)"
                      >
                        <span class="i-mingcute-arrow-down-line size-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="record-tool"
                        :disabled="locked"
                        aria-label="删除"
                        title="删除，可在回收站恢复"
                        @click="remove(record)"
                      >
                        <span class="i-mingcute-delete-2-line size-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                  <p class="record-meta">
                    {{
                      [
                        record.storyTime,
                        sourceLabel(record.source, creation.entries),
                        others(record) && `涉及${others(record)}`
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    }}
                  </p>
                </template>
              </li>
            </ul>
          </section>
        </div>
      </AppScrollArea>
    </AppCollapsible>
  </div>
</template>

<style scoped>
/* 与资料属性同一网格：标签列 48px，控件列从同一位置开始。 */
.records {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--ui-font-size);
}
.records :deep(.app-collapsible-content) {
  padding: 0;
}
.records-trigger {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 20px 0 12px;
  font-size: var(--ui-font-size);
  color: var(--muted-foreground);
}
.records-trigger:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}
.records-title {
  flex-shrink: 0;
  color: var(--foreground);
}
.records-count {
  margin-left: auto;
  white-space: nowrap;
}
.records-pending {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--foreground);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
.records-toolbar {
  display: grid;
  grid-template-columns: 48px 200px auto;
  gap: 12px;
  align-items: center;
  justify-content: start;
  padding: 4px 16px 4px 36px;
}
.records-label {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  white-space: nowrap;
}
.records :deep(.records-asof) {
  width: 200px;
}
.records-scroll {
  max-height: 40vh;
}
.records-body {
  max-width: 672px;
  padding: 0 16px 12px 36px;
}
.records-empty {
  margin: 4px 0 0 60px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.records-error {
  margin: 0;
  padding: 4px 16px 4px 96px;
  color: var(--destructive);
  font-size: var(--ui-caption-size);
}
.records-group-title {
  margin: 10px 0 2px;
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
