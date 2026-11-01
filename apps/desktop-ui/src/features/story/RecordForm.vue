<script setup lang="ts">
import { computed, ref } from 'vue';

import { chapterOrder, type RecordFields } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { useCreationStore } from '@/features/creation';

import { placementFrom, placementValue } from './labels';

/** 新增或修改一条事件：内容、发生在、可选故事时间；出处收在「更多」里。 */
const props = defineProps<{ initial: RecordFields; busy: boolean; submitLabel: string }>();
const emit = defineEmits<{ submit: [fields: RecordFields]; cancel: [] }>();
const creation = useCreationStore();
const text = ref(props.initial.text);
const placement = ref(placementValue(props.initial.placement));
const storyTime = ref(props.initial.storyTime);
const source = ref(props.initial.source.kind === 'author' ? 'author' : props.initial.source.chapterId);
const more = ref(props.initial.source.kind !== 'author');
const composing = ref(false);
const chapters = computed(() =>
  chapterOrder(creation.entries).map(id => ({ id, title: creation.entries.find(entry => entry.id === id)!.title }))
);

function submit() {
  if (!text.value.trim() || props.busy) return;
  const initial = props.initial.source;
  // 出处未改时保留原来核对过的修订；改为某章时绑定该章当前正式修订。
  const unchanged = initial.kind === 'chapter' && initial.chapterId === source.value;
  // 初始值可能来自响应式状态，提交前构造独立的传输数据。
  emit('submit', {
    resourceIds: [...props.initial.resourceIds],
    text: text.value.trim(),
    placement: placementFrom(placement.value),
    storyTime: storyTime.value.trim(),
    source:
      source.value === 'author'
        ? { kind: 'author' }
        : unchanged
          ? { ...initial }
          : {
              kind: 'chapter',
              chapterId: source.value,
              revisionId: creation.entries.find(entry => entry.id === source.value)!.revisionId
            }
  });
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
    return;
  }
  if (event.key !== 'Enter' || event.shiftKey || composing.value || event.isComposing) return;
  event.preventDefault();
  submit();
}
</script>

<template>
  <form class="record-form" @submit.prevent="submit" @keydown="keydown">
    <span class="record-form-label">内容</span>
    <AppTextarea
      v-model="text"
      :rows="2"
      aria-label="事件内容"
      placeholder="发生了什么，Enter 保存，Shift+Enter 换行"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <span class="record-form-label">发生在</span>
    <AppSelect v-model="placement" class="record-form-select" aria-label="发生在">
      <AppSelectItem value="opening">开篇之前</AppSelectItem>
      <AppSelectItem v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{
        chapter.title
      }}</AppSelectItem>
      <AppSelectItem value="undetermined">待定</AppSelectItem>
    </AppSelect>
    <span class="record-form-label">故事时间</span>
    <AppInput v-model="storyTime" class="record-form-select" aria-label="故事时间" placeholder="可选，如“三年后”" />
    <template v-if="more">
      <span class="record-form-label">出处</span>
      <AppSelect v-model="source" class="record-form-select" aria-label="出处">
        <AppSelectItem value="author">作者补充</AppSelectItem>
        <AppSelectItem v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{
          chapter.title
        }}</AppSelectItem>
      </AppSelect>
    </template>
    <div class="record-form-actions">
      <button v-if="!more" type="button" class="record-form-more" @click="more = true">
        <span class="i-mingcute-right-line size-3.5" aria-hidden="true" />更多
      </button>
      <span class="flex-1" />
      <AppButton size="xs" variant="ghost" :disabled="busy" @click="emit('cancel')">取消</AppButton>
      <AppButton size="xs" variant="primary" type="submit" :disabled="busy || !text.trim()">{{
        submitLabel
      }}</AppButton>
    </div>
  </form>
</template>

<style scoped>
/* 与资料属性同一网格：标签列 48px，控件列宽度上限 560px。 */
.record-form {
  display: grid;
  grid-template-columns: 48px minmax(0, 560px);
  gap: 8px 12px;
  align-items: center;
  padding: 6px 0 10px;
}
.record-form-label {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  white-space: nowrap;
}
.record-form :deep(.record-form-select) {
  width: 200px;
}
.record-form-actions {
  display: flex;
  grid-column: 2;
  align-items: center;
  gap: 6px;
}
.record-form-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.record-form-more:hover {
  color: var(--foreground);
}
</style>
