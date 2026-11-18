<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { chapterOrder, type MilestoneInput, type RelationInput, type RelationType } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppCombobox } from '@/components/AppCombobox';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useCreationStore } from '@/features/creation';

import { placementFrom, placementValue, resourceTitle } from './labels';

/**
 * 新增或修改一条关系：对方、类型、本资料担任的一方、两端称呼与建立／结束列表。
 * 已有类型的方向固定；换成已有类型时带出它的默认称呼。出处收在「更多」里。
 */
const props = defineProps<{
  initial: RelationInput;
  resourceId: string;
  types: RelationType[];
  busy: boolean;
  submitLabel: string;
}>();
const emit = defineEmits<{ submit: [input: RelationInput]; cancel: [] }>();
const creation = useCreationStore();

type Side = 0 | 1;
type MilestoneDraft = {
  key: string;
  id: string | null;
  kind: MilestoneInput['kind'];
  placement: string;
  storyTime: string;
  source: string;
};

const side = ref<Side>(props.initial.resourceIds[1] === props.resourceId ? 1 : 0);
const otherId = ref(props.initial.resourceIds[side.value === 0 ? 1 : 0]);
const type = ref(props.initial.type);
const directed = ref(props.initial.directed);
const titles = ref<[string, string]>([...props.initial.titles]);
const milestones = ref<MilestoneDraft[]>(
  props.initial.milestones.map(milestone => ({
    key: milestone.id ?? crypto.randomUUID(),
    id: milestone.id,
    kind: milestone.kind,
    placement: placementValue(milestone.placement),
    storyTime: milestone.storyTime,
    source: milestone.source.kind === 'author' ? 'author' : milestone.source.chapterId
  }))
);
const more = ref(props.initial.milestones.some(milestone => milestone.source.kind !== 'author'));

const chapters = computed(() =>
  chapterOrder(creation.entries).map(id => ({ id, title: creation.entries.find(entry => entry.id === id)!.title }))
);
/** 可选的对方：资料区文档；修改候选时保留原来关联的新资料。 */
const resources = computed(() => {
  const list = creation.entries
    .filter(entry => entry.section === 'resource' && entry.kind === 'document' && entry.id !== props.resourceId)
    .map(entry => ({ id: entry.id, title: entry.title }));
  const initial = props.initial.resourceIds.find(id => id && id !== props.resourceId);
  if (initial && !list.some(item => item.id === initial))
    list.push({
      id: initial,
      title: resourceTitle(initial, creation.entries, creation.pendingEntries) ?? '已删除的资料'
    });
  return list;
});
const typeOptions = computed(() => props.types.map(item => ({ value: item.type, label: item.type })));
const known = computed(() => props.types.find(item => item.type === type.value.trim()));
const other = computed<Side>(() => (side.value === 0 ? 1 : 0));
const ownTitle = computed({
  get: () => titles.value[side.value],
  set: value => (titles.value[side.value] = value)
});
const otherTitle = computed({
  get: () => titles.value[other.value],
  set: value => (titles.value[other.value] = value)
});
const valid = computed(
  () =>
    Boolean(otherId.value) &&
    Boolean(type.value.trim()) &&
    titles.value.every(title => title.trim()) &&
    milestones.value.some(milestone => milestone.kind === 'start')
);

// 换成已有类型时采用它的方向与默认称呼；新类型名保留当前设置，由作者决定方向。
watch(known, next => {
  if (!next) return;
  directed.value = next.directed;
  titles.value = [...next.titles];
});

// 发生章节在回收站时保留原位置，作为“待重新定位”可选项。
const relocating = new Set(
  milestones.value
    .map(draft => draft.placement)
    .filter(value => value !== 'opening' && value !== 'undetermined' && !chapters.value.some(item => item.id === value))
);
function add(kind: MilestoneDraft['kind']) {
  const last = milestones.value.at(-1);
  milestones.value.push({
    key: crypto.randomUUID(),
    id: null,
    kind,
    placement: last?.placement ?? 'undetermined',
    storyTime: '',
    source: 'author'
  });
}
function move(index: number, step: -1 | 1) {
  const list = milestones.value;
  [list[index], list[index + step]] = [list[index + step]!, list[index]!];
}
/** 作者保存即核对过：章节出处绑定该章当前正式修订。 */
function sourceOf(draft: MilestoneDraft): MilestoneInput['source'] {
  if (draft.source === 'author') return { kind: 'author' };
  return {
    kind: 'chapter',
    chapterId: draft.source,
    revisionId: creation.entries.find(entry => entry.id === draft.source)!.revisionId
  };
}
function submit() {
  if (!valid.value || props.busy) return;
  const ids: [string, string] =
    side.value === 0 ? [props.resourceId, otherId.value] : [otherId.value, props.resourceId];
  // 表单状态是响应式的，提交前构造独立的传输数据。
  emit('submit', {
    resourceIds: ids,
    type: type.value.trim(),
    directed: directed.value,
    titles: [titles.value[0].trim(), titles.value[1].trim()],
    milestones: milestones.value.map(draft => ({
      id: draft.id,
      kind: draft.kind,
      placement: placementFrom(draft.placement),
      storyTime: draft.storyTime.trim(),
      source: sourceOf(draft)
    }))
  });
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  emit('cancel');
}
</script>

<template>
  <form class="relation-form" @submit.prevent="submit" @keydown="keydown">
    <span class="relation-form-label">对方</span>
    <AppSelect v-model="otherId" class="relation-form-select" aria-label="对方" placeholder="选择资料">
      <AppSelectItem v-for="item in resources" :key="item.id" :value="item.id">{{ item.title }}</AppSelectItem>
    </AppSelect>
    <span class="relation-form-label">类型</span>
    <div class="relation-form-row">
      <AppCombobox
        v-model="type"
        class="relation-form-select"
        :options="typeOptions"
        aria-label="关系类型"
        placeholder="选择或输入类型"
      />
      <label class="relation-form-check" :title="known ? '已有类型的方向固定' : undefined">
        <AppCheckbox v-model="directed" :disabled="Boolean(known)" aria-label="有方向" size="sm" />有方向
      </label>
    </div>
    <template v-if="directed">
      <span class="relation-form-label">身份</span>
      <AppSelect
        :model-value="String(side)"
        class="relation-form-select"
        aria-label="本资料是"
        @update:model-value="value => (side = value === '1' ? 1 : 0)"
      >
        <AppSelectItem value="0">{{ titles[0] || '第一方' }}</AppSelectItem>
        <AppSelectItem value="1">{{ titles[1] || '第二方' }}</AppSelectItem>
      </AppSelect>
    </template>
    <span class="relation-form-label">称呼</span>
    <div class="relation-form-row">
      <span class="relation-form-hint">本资料</span>
      <AppInput v-model="ownTitle" class="relation-form-title" aria-label="本资料的称呼" />
      <span class="relation-form-hint">对方</span>
      <AppInput v-model="otherTitle" class="relation-form-title" aria-label="对方的称呼" />
    </div>
    <span class="relation-form-label relation-form-top">起止</span>
    <div class="relation-form-milestones">
      <div v-for="(draft, index) in milestones" :key="draft.key" class="relation-form-milestone">
        <AppSelect v-model="draft.kind" class="relation-form-kind" aria-label="建立或结束">
          <AppSelectItem value="start">建立</AppSelectItem>
          <AppSelectItem value="end">结束</AppSelectItem>
        </AppSelect>
        <AppSelect v-model="draft.placement" class="relation-form-placement" aria-label="发生在">
          <AppSelectItem value="opening">开篇之前</AppSelectItem>
          <AppSelectItem v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{
            chapter.title
          }}</AppSelectItem>
          <AppSelectItem v-if="relocating.has(draft.placement)" :value="draft.placement">待重新定位</AppSelectItem>
          <AppSelectItem value="undetermined">待定</AppSelectItem>
        </AppSelect>
        <AppInput v-model="draft.storyTime" class="relation-form-time" aria-label="故事时间" placeholder="故事时间" />
        <AppSelect v-if="more" v-model="draft.source" class="relation-form-placement" aria-label="出处">
          <AppSelectItem value="author">作者补充</AppSelectItem>
          <AppSelectItem v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{
            chapter.title
          }}</AppSelectItem>
        </AppSelect>
        <span class="relation-form-tools">
          <AppTooltip text="上移（同一位置内的先后）">
            <button
              type="button"
              class="relation-form-tool"
              :disabled="index === 0"
              aria-label="上移"
              @click="move(index, -1)"
            >
              <span class="i-mingcute-arrow-up-line size-3.5" aria-hidden="true" />
            </button>
          </AppTooltip>
          <AppTooltip text="下移（同一位置内的先后）">
            <button
              type="button"
              class="relation-form-tool"
              :disabled="index === milestones.length - 1"
              aria-label="下移"
              @click="move(index, 1)"
            >
              <span class="i-mingcute-arrow-down-line size-3.5" aria-hidden="true" />
            </button>
          </AppTooltip>
          <AppTooltip text="移除">
            <button type="button" class="relation-form-tool" aria-label="移除" @click="milestones.splice(index, 1)">
              <span class="i-mingcute-close-line size-3.5" aria-hidden="true" />
            </button>
          </AppTooltip>
        </span>
      </div>
      <div class="relation-form-row">
        <AppButton size="xs" variant="ghost" @click="add('start')">
          <span class="i-mingcute-add-line size-3.5" aria-hidden="true" />建立
        </AppButton>
        <AppButton size="xs" variant="ghost" @click="add('end')">
          <span class="i-mingcute-add-line size-3.5" aria-hidden="true" />结束
        </AppButton>
        <span v-if="!milestones.some(milestone => milestone.kind === 'start')" class="relation-form-hint"
          >至少需要一次建立</span
        >
      </div>
    </div>
    <div class="relation-form-actions">
      <button v-if="!more" type="button" class="relation-form-more" @click="more = true">
        <span class="i-mingcute-right-line size-3.5" aria-hidden="true" />出处
      </button>
      <span class="flex-1" />
      <AppButton size="xs" variant="ghost" :disabled="busy" @click="emit('cancel')">取消</AppButton>
      <AppButton size="xs" variant="primary" type="submit" :disabled="busy || !valid">{{ submitLabel }}</AppButton>
    </div>
  </form>
</template>

<style scoped>
/* 与事件表单同一网格：标签列 48px，控件列宽度上限 560px。 */
.relation-form {
  display: grid;
  grid-template-columns: 48px minmax(0, 560px);
  gap: 8px 12px;
  align-items: center;
  padding: 6px 0 10px;
}
.relation-form-label {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  white-space: nowrap;
}
.relation-form-top {
  align-self: start;
  line-height: 28px;
}
.relation-form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.relation-form-hint {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  white-space: nowrap;
}
.relation-form-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--ui-caption-size);
}
.relation-form :deep(.relation-form-select) {
  width: 200px;
}
.relation-form :deep(.relation-form-title) {
  width: 96px;
}
.relation-form-milestones {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.relation-form-milestone {
  display: flex;
  align-items: center;
  gap: 6px;
}
.relation-form :deep(.relation-form-kind) {
  width: 88px;
}
.relation-form :deep(.relation-form-placement) {
  width: 140px;
}
.relation-form :deep(.relation-form-time) {
  width: 104px;
}
.relation-form-tools {
  display: flex;
  gap: 2px;
}
.relation-form-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-control-sm);
  color: var(--muted-foreground);
}
.relation-form-tool:hover:not(:disabled) {
  background: var(--surface-muted);
  color: var(--foreground);
}
.relation-form-tool:disabled {
  opacity: 0.4;
}
.relation-form-actions {
  display: flex;
  grid-column: 2;
  align-items: center;
  gap: 6px;
}
.relation-form-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.relation-form-more:hover {
  color: var(--foreground);
}
</style>
