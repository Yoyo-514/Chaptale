<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  chapterOrder,
  type RecordChange,
  type RecordFields,
  type RelationChange,
  type RelationInput
} from '@chaptale/creation/contracts';

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
  candidates?: { records: RecordChange[]; relations: RelationChange[] };
  busy?: boolean;
  /** 出处章节正文核对后改过的事件与建立／结束 ID。 */
  changedSources: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  decide: [change: RecordChange | RelationChange, decision: 'accept' | 'reject'];
  updateRecord: [change: RecordChange, fields: RecordFields];
  updateRelation: [change: RelationChange, input: RelationInput];
}>();
const creation = useCreationStore();
const open = ref(true);
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
const pending = computed(() => (props.candidates?.records.length ?? 0) + (props.candidates?.relations.length ?? 0));
</script>

<template>
  <div class="story" role="region" aria-label="关系与事件">
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
        </button>
      </template>
      <AppScrollArea class="story-scroll">
        <RelationList
          ref="relationList"
          :work-id="workId"
          :resource-id="resourceId"
          :as-of="progress"
          :items="relations"
          :reviewing="candidates !== undefined"
          :busy="busy"
          :changed-sources="changedSources"
          @decide="(change, decision) => emit('decide', change, decision)"
          @update="(change, input) => emit('updateRelation', change, input)"
        />
        <RecordList
          :work-id="workId"
          :resource-id="resourceId"
          :as-of="progress"
          :milestones="milestones"
          :candidates="candidates?.records"
          :busy="busy"
          :changed-sources="changedSources"
          @decide="(change, decision) => emit('decide', change, decision)"
          @update="(change, fields) => emit('updateRecord', change, fields)"
          @locate="id => relationList?.locate(id)"
        />
      </AppScrollArea>
    </AppCollapsible>
    <!-- 进度与折叠触发器并列，避免控件嵌套在按钮里。 -->
    <div class="story-progress">
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
.story-pending {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--foreground);
  font-size: var(--ui-caption-size);
  line-height: 20px;
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
