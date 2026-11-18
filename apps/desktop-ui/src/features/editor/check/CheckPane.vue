<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  relationTypes,
  type RecordFields,
  type RelationInput,
  type StoryRecord,
  type StoryRelation
} from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { requestCreation, useCreationStore } from '@/features/creation';
import { RecordForm, RelationForm, milestoneText, placementLabel, resourceTitle } from '@/features/story';
import { toErrorMessage } from '@/utils/desktop-api';

import { useHistoryStore } from '../history/store';
import { useEditorStore } from '../store';
import { type CheckTab, useCheckStore } from './store';

/** 核对标签：本章出处、正文改过后待核对的事件与关系建立／结束，按资料分组，可逐条修改、移除或整章确认。 */
const props = defineProps<{ tab: CheckTab }>();
const check = useCheckStore();
const creation = useCreationStore();
const editor = useEditorStore();
const history = useHistoryStore();

type Row =
  | { kind: 'record'; key: string; record: StoryRecord }
  | { kind: 'milestone'; key: string; relation: StoryRelation; milestoneId: string; resourceId: string };

const chapter = computed(() => creation.entries.find(entry => entry.id === props.tab.chapterId)!);
const pending = computed(() => check.reviewOf(props.tab.chapterId));
const savedSince = computed(() => chapter.value.revisionId !== props.tab.revisionId);
const name = (id: string) => resourceTitle(id, creation.entries, creation.pendingEntries) ?? '已删除的资料';

/** 事件归入第一份涉及的资料，建立／结束归入关系第一方，各出现一次。 */
const groups = computed(() => {
  const review = pending.value;
  if (!review) return [];
  const byResource = new Map<string, Row[]>();
  const push = (resourceId: string, row: Row) =>
    byResource.set(resourceId, [...(byResource.get(resourceId) ?? []), row]);
  for (const record of creation.records)
    if (review.recordIds.includes(record.id)) push(record.resourceIds[0]!, { kind: 'record', key: record.id, record });
  for (const relation of creation.relations)
    for (const milestone of relation.milestones)
      if (review.milestoneIds.includes(milestone.id))
        push(relation.resourceIds[0], {
          kind: 'milestone',
          key: milestone.id,
          relation,
          milestoneId: milestone.id,
          resourceId: relation.resourceIds[0]
        });
  return [...byResource].map(([resourceId, rows]) => ({ resourceId, title: name(resourceId), rows }));
});

function rowText(row: Row) {
  if (row.kind === 'record') return row.record.text;
  const milestone = row.relation.milestones.find(item => item.id === row.milestoneId)!;
  const otherId =
    row.relation.resourceIds[0] === row.resourceId ? row.relation.resourceIds[1] : row.relation.resourceIds[0];
  return milestoneText(row.relation, row.resourceId, milestone.kind, name(otherId));
}
function rowMeta(row: Row) {
  const item = row.kind === 'record' ? row.record : row.relation.milestones.find(m => m.id === row.milestoneId)!;
  return [placementLabel(item.placement, creation.entries), item.storyTime].filter(Boolean).join(' · ');
}

const editing = ref<string | null>(null);
const saving = ref(false);
const error = ref('');
async function run(operation: () => Promise<unknown>) {
  saving.value = true;
  error.value = '';
  try {
    await operation();
    editing.value = null;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    saving.value = false;
  }
}
const command = () => ({ commandId: crypto.randomUUID(), workId: props.tab.workId });
function fieldsOf(record: StoryRecord): RecordFields {
  return {
    resourceIds: record.resourceIds,
    text: record.text,
    source: record.source,
    placement: record.placement,
    storyTime: record.storyTime
  };
}
function saveRecord(record: StoryRecord, fields: RecordFields) {
  return run(() =>
    requestCreation('updateRecord', {
      ...command(),
      recordId: record.id,
      expectedRevisionId: record.revisionId,
      ...fields
    })
  );
}
function saveRelation(relation: StoryRelation, input: RelationInput) {
  return run(() =>
    requestCreation('updateRelation', {
      ...command(),
      relationId: relation.id,
      expectedRevisionId: relation.revisionId,
      ...input
    })
  );
}
function remove(row: Row) {
  if (row.kind === 'record')
    return run(() =>
      requestCreation('removeRecord', {
        ...command(),
        recordId: row.record.id,
        expectedRevisionId: row.record.revisionId
      })
    );
  const { relation } = row;
  return saveRelation(relation, {
    resourceIds: relation.resourceIds,
    type: relation.type,
    directed: relation.directed,
    titles: relation.titles,
    milestones: relation.milestones.filter(item => item.id !== row.milestoneId)
  });
}
const types = computed(() => relationTypes(creation.relations));
const busy = computed(() => saving.value || props.tab.busy);
</script>

<template>
  <div class="check-tab">
    <header class="check-header">
      <div class="check-heading">
        <h2 class="check-title">核对《{{ chapter.title }}》</h2>
        <p v-if="pending" class="check-note">
          本章正文改过，下面 {{ check.countOf(tab.chapterId) }} 条记录出自本章，确认是否仍然适用。<template
            v-if="savedSince"
            >打开核对后本章又保存过，确认只针对打开时的版本。</template
          >
        </p>
        <p v-else class="check-note">本章记录都已核对。</p>
      </div>
      <AppButton
        v-if="pending"
        size="sm"
        variant="ghost"
        @click="history.compare(tab.chapterId, pending.earliestRevisionId)"
        >查看本章改动</AppButton
      >
      <AppButton v-if="pending" size="sm" variant="primary" :disabled="busy" @click="check.confirm(tab.chapterId)"
        >本章记录仍适用</AppButton
      >
      <AppButton v-else size="sm" @click="check.close(tab.chapterId)">关闭</AppButton>
    </header>
    <p v-if="error || tab.error" class="check-error" role="alert">{{ error || tab.error }}</p>
    <div class="check-body">
      <section v-for="group in groups" :key="group.resourceId" class="check-group" :aria-label="group.title">
        <button type="button" class="check-resource" @click="editor.openDocument(group.resourceId)">
          {{ group.title }}
        </button>
        <ul class="check-list">
          <li v-for="row in group.rows" :key="row.key" class="check-row" :class="{ editing: editing === row.key }">
            <template v-if="editing === row.key">
              <RecordForm
                v-if="row.kind === 'record'"
                :initial="fieldsOf(row.record)"
                :busy="busy"
                submit-label="保存"
                @submit="fields => saveRecord(row.record, fields)"
                @cancel="editing = null"
              />
              <RelationForm
                v-else
                :initial="row.relation"
                :resource-id="row.resourceId"
                :types="types"
                :busy="busy"
                submit-label="保存"
                @submit="input => saveRelation(row.relation, input)"
                @cancel="editing = null"
              />
            </template>
            <template v-else>
              <div class="check-line">
                <span v-if="row.kind === 'milestone'" class="check-kind">关系变化</span>
                <span class="check-text">{{ rowText(row) }}</span>
                <span class="check-actions">
                  <AppButton size="xs" variant="ghost" :disabled="busy" @click="editing = row.key">修改</AppButton>
                  <AppButton size="xs" variant="ghost" :disabled="busy" @click="remove(row)">移除</AppButton>
                </span>
              </div>
              <p v-if="rowMeta(row)" class="check-meta">{{ rowMeta(row) }}</p>
            </template>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.check-tab {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.check-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
}
.check-heading {
  flex: 1;
  min-width: 0;
}
.check-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.check-note {
  margin: 2px 0 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.check-error {
  margin: 0;
  padding: 6px 16px;
  color: var(--destructive);
  font-size: var(--ui-font-size);
}
.check-body {
  flex: 1;
  overflow: auto;
  padding: 8px 16px 24px;
}
.check-group + .check-group {
  margin-top: 12px;
}
.check-resource {
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-control-sm);
  background: none;
  color: var(--foreground);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.check-resource:hover {
  background: var(--surface-hover);
}
.check-list {
  margin: 2px 0 0 16px;
  padding: 0;
  list-style: none;
}
.check-row {
  padding: 4px 8px;
  border-radius: var(--radius-control-sm);
}
.check-row:not(.editing):hover {
  background: var(--surface-hover);
}
.check-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 24px;
}
.check-kind {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: var(--surface-muted);
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
.check-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.check-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  opacity: 0;
}
.check-row:hover .check-actions,
.check-row:focus-within .check-actions {
  opacity: 1;
}
.check-meta {
  margin: 2px 0 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
</style>
