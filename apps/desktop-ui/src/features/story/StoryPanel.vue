<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import {
  chapterOrder,
  type RecordChange,
  type RecordFields,
  type RelationChange,
  type RelationInput
} from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppCollapsible } from '@/components/AppCollapsible';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useCreationStore } from '@/features/creation';

import RecordList from './RecordList.vue';
import RelationList from './RelationList.vue';
import { milestoneRows, relationItems } from './relations';

/**
 * 资料页的“关系与事件”折叠块，标题行右侧的“截至”进度同时作用于两节。
 * 传入 candidates 时为审阅视图，本会话的事件与关系候选穿插在正式内容中逐条处理。
 */
const props = defineProps<{
  workId: string;
  resourceId: string;
  candidates?: { records: RecordChange[]; relations: RelationChange[]; waiting: ReadonlyMap<string, string[]> };
  busy?: boolean;
  /** 出处章节正文核对后改过的事件与建立／结束 ID。 */
  changedSources: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  decide: [change: RecordChange | RelationChange, decision: 'accept' | 'reject'];
  updateRecord: [change: RecordChange, fields: RecordFields];
  updateRelation: [change: RelationChange, input: RelationInput];
  /** 资料页上打开本资料的审阅标签，sessionId 为候选所在会话。 */
  review: [sessionId: string];
  /** 审阅视图中打开候选出处章节的审阅。 */
  source: [chapterId: string];
}>();
const creation = useCreationStore();
const asOf = ref('all');
const progress = computed(() => (asOf.value === 'all' ? null : asOf.value));
const relationList = ref<InstanceType<typeof RelationList> | null>(null);

const chapters = computed(() =>
  chapterOrder(creation.entries).map(id => ({ id, title: creation.entries.find(entry => entry.id === id)!.title }))
);
const relations = computed(() =>
  relationItems(creation.relations, props.candidates?.relations ?? [], props.resourceId)
);
const milestones = computed(() =>
  milestoneRows(relations.value, props.resourceId, creation.entries, creation.pendingEntries)
);
/** 资料页（非审阅视图）上，本资料涉及的待接受事件与关系，审阅在审阅标签中进行。 */
const elsewhere = computed(() => (props.candidates ? [] : (creation.pendingStories.get(props.resourceId) ?? [])));
const pending = computed(
  () => (props.candidates?.records.length ?? 0) + (props.candidates?.relations.length ?? 0) + elsewhere.value.length
);
/** 默认折叠；有待接受的候选时展开。 */
const open = ref(pending.value > 0);
watch(pending, (count, previous) => {
  if (count > previous) open.value = true;
});
const ownRecords = computed(() => creation.records.filter(record => record.resourceIds.includes(props.resourceId)));
const toCheck = computed(
  () =>
    ownRecords.value.filter(record => props.changedSources.has(record.id)).length +
    relations.value.flatMap(item => item.relation.milestones).filter(item => props.changedSources.has(item.id)).length
);
/** 折叠时的摘要：关系、事件数量，无内容时省略。 */
const summary = computed(() =>
  [
    relations.value.length && `${relations.value.length} 条关系`,
    ownRecords.value.length && `${ownRecords.value.length} 条事件`
  ]
    .filter(Boolean)
    .join(' · ')
);
const panel = ref<HTMLElement>();
const recordList = ref<InstanceType<typeof RecordList>>();
const target = ref<{ kind: 'record' | 'relation'; id: string }>();
function locate(kind: 'record' | 'relation', id: string) {
  open.value = true;
  asOf.value = 'all';
  target.value = { kind, id };
}
// 折叠内容按需挂载；等列表就绪再滚动，首次从搜索打开资料也走同一入口。
watch(
  [target, recordList, relationList],
  async ([request, records, relationRows]) => {
    if (!request || !records || !relationRows) return;
    target.value = undefined;
    await nextTick();
    if (request.kind === 'relation') await relationRows.locate(request.id);
    else {
      const row = panel.value?.querySelector<HTMLElement>(`[data-record-id="${CSS.escape(request.id)}"]`);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
    }
  },
  { flush: 'post' }
);
defineExpose({ locate });
</script>

<template>
  <div ref="panel" class="story" role="region" aria-label="关系与事件">
    <AppCollapsible v-model="open" variant="plain">
      <template #trigger>
        <button type="button" class="story-trigger">
          <span
            :class="open ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          <span class="story-title">关系与事件</span>
          <span v-if="pending" class="story-pending">{{ pending }} 条待接受</span>
          <span v-if="toCheck" class="story-pending">{{ toCheck }} 条待核对</span>
          <span v-if="!open && summary" class="story-summary">{{ summary }}</span>
        </button>
      </template>
      <p v-if="elsewhere.length" class="story-review" role="status">
        有 {{ elsewhere.length }} 条待接受的事件或关系
        <AppButton size="xs" variant="primary" @click="emit('review', elsewhere[0]!.sessionId)">去审阅</AppButton>
      </p>
      <AppScrollArea class="story-scroll">
        <RelationList
          ref="relationList"
          :work-id="workId"
          :resource-id="resourceId"
          :as-of="progress"
          :items="relations"
          :reviewing="candidates !== undefined"
          :waiting="candidates?.waiting"
          :busy="busy"
          :changed-sources="changedSources"
          @decide="(change, decision) => emit('decide', change, decision)"
          @update="(change, input) => emit('updateRelation', change, input)"
          @source="id => emit('source', id)"
        />
        <RecordList
          ref="recordList"
          :work-id="workId"
          :resource-id="resourceId"
          :as-of="progress"
          :milestones="milestones"
          :candidates="candidates?.records"
          :waiting="candidates?.waiting"
          :busy="busy"
          :changed-sources="changedSources"
          @decide="(change, decision) => emit('decide', change, decision)"
          @update="(change, fields) => emit('updateRecord', change, fields)"
          @locate="id => relationList?.locate(id)"
          @source="id => emit('source', id)"
        />
      </AppScrollArea>
    </AppCollapsible>
    <!-- 进度与折叠触发器并列，避免控件嵌套在按钮里。 -->
    <div v-if="open" class="story-progress">
      <span class="story-label">截至</span>
      <AppSelect v-model="asOf" class="story-asof" variant="ghost" size="sm" aria-label="查看到">
        <AppSelectItem value="all">全部章节</AppSelectItem>
        <AppSelectItem v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{
          chapter.title
        }}</AppSelectItem>
      </AppSelect>
    </div>
  </div>
</template>

<style scoped>
.story {
  position: relative;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--ui-font-size);
}
.story :deep(.app-collapsible-content) {
  padding: 0;
}
.story-trigger {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 220px 0 12px;
  color: var(--muted-foreground);
  font-size: var(--ui-font-size);
}
.story-trigger:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}
.story-title {
  flex-shrink: 0;
  color: var(--foreground);
}
.story-review {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
  margin: 0 12px 6px 32px;
  padding: 4px 4px 4px 10px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--foreground);
  font-size: var(--ui-caption-size);
}
.story-pending {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--foreground);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
.story-summary {
  flex-shrink: 0;
  font-size: var(--ui-caption-size);
}
.story-progress {
  position: absolute;
  top: 0;
  right: 16px;
  display: flex;
  height: 30px;
  align-items: center;
  gap: 4px;
}
.story-label {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.story :deep(.story-asof) {
  width: auto;
  max-width: 180px;
}
.story-scroll {
  max-height: 40vh;
}
</style>
