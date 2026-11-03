<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

import {
  relationTypes,
  type RelationChange,
  type RelationInput,
  type RelationState
} from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { requestCreation, useCreationStore } from '@/features/creation';
import { toErrorMessage } from '@/utils/desktop-api';

import DraftSourceHint from './DraftSourceHint.vue';
import {
  chapterTitles,
  milestoneText,
  placementLabel,
  relationSide,
  relationSpan,
  resourceTitle,
  sourceLabel
} from './labels';
import RelationForm from './RelationForm.vue';
import { relationDiff, relationVisibility, type RelationItem } from './relations';
import StorySection from './StorySection.vue';

/**
 * 资料涉及的关系，每条一行：对方称呼、对方名称、起止章节与截至查看进度的状态，点击展开详情。
 * reviewing 时为审阅视图：本会话候选穿插其中逐条处理，正式关系只读；否则作者可新增、修改和删除。
 */
const props = defineProps<{
  workId: string;
  resourceId: string;
  asOf: string | null;
  items: RelationItem[];
  reviewing: boolean;
  /** 须先处理本章正文的候选 ID 到待审正文所在章节。 */
  waiting?: ReadonlyMap<string, string[]>;
  busy?: boolean;
  /** 出处章节正文核对后改过的事件与建立／结束 ID。 */
  changedSources: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  decide: [change: RelationChange, decision: 'accept' | 'reject'];
  update: [change: RelationChange, input: RelationInput];
  /** 打开出处章节的审阅。 */
  source: [chapterId: string];
}>();
const creation = useCreationStore();
const adding = ref(false);
const editingId = ref<string | null>(null);
const expandedId = ref<string | null>(null);
const saving = ref(false);
const error = ref('');
const list = ref<HTMLElement | null>(null);
const locked = computed(() => saving.value || Boolean(props.busy));

const types = computed(() => relationTypes([...creation.relations, ...props.items.map(item => item.relation)]));
const formalCount = computed(() => props.items.filter(item => item.revisionId !== null).length);
const pendingCount = computed(() => props.items.filter(item => item.change).length);
const rows = computed(() =>
  props.items.flatMap(item => {
    const state = relationVisibility(item.relation, creation.entries, props.asOf);
    if (state === null && !item.change) return [];
    const side = relationSide(item.relation, props.resourceId);
    const name = resourceTitle(side.otherId, creation.entries, creation.pendingEntries);
    return [
      {
        ...item,
        ...side,
        name,
        state,
        span: relationSpan(item.relation, creation.entries, props.asOf),
        undetermined: item.relation.milestones.some(milestone => milestone.placement.kind === 'undetermined')
      }
    ];
  })
);
const stateLabels: Record<RelationState, string> = { active: '持续', ended: '已结束', undetermined: '' };

function changeLabel(change: RelationChange) {
  if (change.deleted) return '移除';
  if (change.base === null) return '新增';
  return change.candidate.resourceIds.includes(props.resourceId) ? '修改' : '不再涉及本资料';
}
function newInput(): RelationInput {
  return {
    resourceIds: [props.resourceId, ''],
    type: '',
    directed: false,
    titles: ['', ''],
    milestones: [
      {
        id: null,
        kind: 'start',
        source: { kind: 'author' },
        placement: props.asOf === null ? { kind: 'undetermined' } : { kind: 'chapter', chapterId: props.asOf },
        storyTime: ''
      }
    ]
  };
}

/** 事件列表点击“关系变化”时展开对应关系并滚动到可见位置。 */
async function locate(relationId: string) {
  expandedId.value = relationId;
  await nextTick();
  list.value?.querySelector(`[data-relation-id="${relationId}"]`)?.scrollIntoView({ block: 'nearest' });
}
defineExpose({ locate });

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
async function create(input: RelationInput) {
  const done = await run(() =>
    requestCreation('createRelation', { commandId: crypto.randomUUID(), workId: props.workId, ...input })
  );
  if (done) adding.value = false;
}
async function save(item: RelationItem, input: RelationInput) {
  if (item.change) {
    emit('update', item.change, input);
    editingId.value = null;
    return;
  }
  const done = await run(() =>
    requestCreation('updateRelation', {
      commandId: crypto.randomUUID(),
      workId: props.workId,
      relationId: item.relation.id,
      expectedRevisionId: item.revisionId!,
      ...input
    })
  );
  if (done) editingId.value = null;
}
function remove(item: RelationItem) {
  return run(() =>
    requestCreation('removeRelation', {
      commandId: crypto.randomUUID(),
      workId: props.workId,
      relationId: item.relation.id,
      expectedRevisionId: item.revisionId!
    })
  );
}
</script>

<template>
  <StorySection
    title="关系"
    :count="formalCount"
    :pending="pendingCount"
    :add-label="reviewing ? undefined : '关系'"
    :add-disabled="adding"
    @add="adding = true"
  >
    <p v-if="error" class="relations-error" role="alert">{{ error }}</p>
    <RelationForm
      v-if="adding"
      :initial="newInput()"
      :resource-id="resourceId"
      :types="types"
      :busy="locked"
      submit-label="保存"
      @submit="create"
      @cancel="adding = false"
    />
    <p v-if="!rows.length && !adding" class="relations-empty">
      {{ asOf === null ? '还没有关系' : '截至这一章还没有关系' }}
    </p>
    <ul ref="list" class="relations-list">
      <li
        v-for="row in rows"
        :key="row.relation.id"
        class="relation"
        :data-relation-id="row.relation.id"
        :class="{ 'relation-pending': row.change, 'relation-editing': editingId === row.relation.id }"
      >
        <RelationForm
          v-if="editingId === row.relation.id"
          :initial="row.relation"
          :resource-id="resourceId"
          :types="types"
          :busy="locked"
          :submit-label="row.change ? '保存修改' : '保存'"
          @submit="input => save(row, input)"
          @cancel="editingId = null"
        />
        <template v-else>
          <button
            type="button"
            class="relation-main"
            :aria-expanded="expandedId === row.relation.id"
            @click="expandedId = expandedId === row.relation.id ? null : row.relation.id"
          >
            <span v-if="row.change" class="relation-badge">{{ changeLabel(row.change) }}</span>
            <span class="relation-title">{{ row.otherTitle }}</span>
            <span class="relation-name" :class="{ 'relation-deleted': row.name === null }">{{
              row.name ?? '已删除的资料'
            }}</span>
            <span class="relation-span">{{ row.span }}</span>
            <span v-if="row.undetermined" class="relation-state">起止待定</span>
            <span v-if="row.state && stateLabels[row.state]" class="relation-state" :class="`relation-${row.state}`">{{
              stateLabels[row.state]
            }}</span>
          </button>
          <div v-if="expandedId === row.relation.id" class="relation-detail">
            <p class="relation-meta">
              {{ row.relation.type }}{{ row.relation.directed ? '' : '（无方向）' }} · 本资料是{{ row.ownTitle }}
            </p>
            <p v-if="!row.relation.milestones.some(milestone => milestone.kind === 'start')" class="relation-meta">
              建立所在章节已删除，恢复该章节后回到原处
            </p>
            <ul v-if="!row.change || row.change.base === null" class="relation-milestones">
              <li v-for="milestone in row.relation.milestones" :key="milestone.id">
                <span class="relation-milestone-place">{{
                  placementLabel(milestone.placement, creation.entries)
                }}</span>
                {{ milestoneText(row.relation, resourceId, milestone.kind, row.name ?? '已删除的资料') }}
                <span class="relation-meta">{{
                  [
                    milestone.storyTime,
                    sourceLabel(milestone.source, creation.entries, changedSources.has(milestone.id))
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}</span>
              </li>
            </ul>
            <ul v-else class="relation-diff">
              <li
                v-for="(line, index) in relationDiff(row.change.base, row.change.candidate, creation.entries)"
                :key="index"
                :class="`relation-diff-${line.kind}`"
              >
                {{ line.kind === 'added' ? '新增' : line.kind === 'removed' ? '删除' : '修改' }}：{{ line.text }}
              </li>
            </ul>
            <div v-if="!reviewing" class="relation-actions">
              <AppButton size="xs" variant="ghost" :disabled="locked" @click="editingId = row.relation.id"
                >修改</AppButton
              >
              <AppButton size="xs" variant="ghost" :disabled="locked" title="删除，可在回收站恢复" @click="remove(row)"
                >删除</AppButton
              >
            </div>
          </div>
          <template v-if="row.change">
            <p v-if="row.change.basis" class="relation-basis">依据：{{ row.change.basis }}</p>
            <DraftSourceHint
              v-if="waiting?.has(row.change.id)"
              :chapter-ids="waiting.get(row.change.id)!"
              @open="id => emit('source', id)"
            />
            <p v-if="row.change.conflicts.length" class="relation-conflict" role="status">
              Agent 修改期间正式关系也有变化，展开检查后修改并保存即视为已解决。
            </p>
            <div class="relation-actions">
              <AppButton size="xs" variant="ghost" :disabled="locked" @click="emit('decide', row.change, 'reject')"
                >拒绝</AppButton
              >
              <AppButton
                v-if="!row.change.deleted"
                size="xs"
                variant="ghost"
                :disabled="locked"
                @click="editingId = row.relation.id"
                >修改</AppButton
              >
              <AppButton
                size="xs"
                variant="primary"
                :disabled="locked || row.change.conflicts.length > 0 || waiting?.has(row.change.id)"
                :title="
                  row.change.conflicts.length
                    ? '请先处理冲突'
                    : waiting?.has(row.change.id)
                      ? `先处理${chapterTitles(waiting.get(row.change.id)!, creation.entries, creation.pendingEntries)}`
                      : undefined
                "
                @click="emit('decide', row.change, 'accept')"
                >接受</AppButton
              >
            </div>
          </template>
        </template>
      </li>
    </ul>
  </StorySection>
</template>

<style scoped>
.relations-empty {
  margin: 4px 0 0 60px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.relations-error {
  margin: 0;
  padding: 4px 0 4px 60px;
  color: var(--destructive);
  font-size: var(--ui-caption-size);
}
.relations-list {
  margin: 4px 0 0 52px;
  padding: 0;
  list-style: none;
}
.relation {
  padding: 2px 8px;
  border-radius: var(--radius-control-sm);
}
.relation:hover {
  background: var(--surface-hover);
}
/* 修改时表单回到与资料属性相同的网格位置。 */
.relation.relation-editing {
  padding: 0;
  border-left: 0;
  background: none;
}
.relation-editing :deep(.relation-form) {
  margin-left: -52px;
}
.relation-pending {
  border-left: 2px solid var(--warning);
  background: color-mix(in srgb, var(--warning) 6%, transparent);
}
.relation-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  min-height: 24px;
  text-align: left;
}
.relation-title {
  flex-shrink: 0;
  min-width: 3em;
  color: var(--muted-foreground);
}
.relation-name {
  flex-shrink: 0;
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.relation-deleted {
  color: var(--muted-foreground);
  text-decoration: line-through;
}
.relation-span {
  flex: 1;
  min-width: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.relation-state {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.relation-active {
  color: var(--foreground);
}
.relation-badge {
  flex-shrink: 0;
  align-self: center;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
.relation-detail {
  padding: 2px 0 4px;
}
.relation-meta,
.relation-basis {
  margin: 2px 0 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.relation-basis {
  font-style: italic;
}
.relation-milestones,
.relation-diff {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.relation-milestones li,
.relation-diff li {
  padding: 1px 0;
}
.relation-milestone-place {
  display: inline-block;
  min-width: 7em;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.relation-diff-removed {
  color: var(--muted-foreground);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--destructive) 60%, transparent);
}
.relation-conflict {
  margin: 4px 0 0;
  font-size: var(--ui-caption-size);
}
.relation-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}
</style>
