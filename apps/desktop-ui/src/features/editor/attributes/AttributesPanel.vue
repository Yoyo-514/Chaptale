<script setup lang="ts">
import { computed, ref } from 'vue';

import { isImageFile, type Entry, type ResourceAttributes } from '@chaptale/creation/contracts';

import { AppCollapsible } from '@/components/AppCollapsible';
import { AppCombobox } from '@/components/AppCombobox';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTagInput } from '@/components/AppTagInput';
import { FilePreview, useCreationStore, useFileImage } from '@/features/creation';

import { useEditorStore } from '../store';
import type { EditorTab } from '../types';

const typeOptions = ['人物', '地点', '组织', '物品', '设定', '规划', '笔记'].map(value => ({ value, label: value }));

const props = defineProps<{ tab: EditorTab }>();
const editor = useEditorStore();
const creation = useCreationStore();
const open = ref(false);
const attributes = computed(() => props.tab.attributes!);
const images = computed(() => creation.entries.filter(isImageFile));
/** 封面条目移入回收站或被删除后视为未设置。 */
const cover = computed(() => images.value.find(entry => entry.id === attributes.value.cover) ?? null);
const coverSrc = useFileImage(computed(() => cover.value && { workId: props.tab.workId, entry: cover.value }));
const preview = ref<Entry | null>(null);
/** 折叠时右侧的摘要：类型、别名、标签依次排列，空项省略。 */
const summary = computed(() => {
  const { type, aliases, tags } = attributes.value;
  return [
    { label: '', text: type },
    { label: '别名', text: aliases.join('、') },
    { label: '标签', text: tags.join('、') }
  ].filter(part => part.text);
});
const summaryText = computed(
  () => summary.value.map(part => (part.label ? `${part.label} ${part.text}` : part.text)).join('，') || '未设置'
);

function update(fields: Partial<ResourceAttributes>) {
  editor.updateMetadata(props.tab.id, { attributes: { ...attributes.value, ...fields } });
}
</script>

<template>
  <div class="attributes">
    <AppCollapsible v-model="open" variant="plain" aria-label="资料属性" role="region">
      <template #trigger>
        <button type="button" class="attributes-trigger" :aria-label="open ? '属性' : `属性 ${summaryText}`">
          <span
            :class="open ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
            class="attributes-chevron size-4"
            aria-hidden="true"
          />
          <span class="attributes-title">属性</span>
          <span v-if="coverSrc" class="attributes-cover-space" aria-hidden="true" />
          <span v-if="!open" class="attributes-summary" :title="summaryText">
            <span v-for="part in summary" :key="part.label" class="attributes-summary-item">
              <span v-if="part.label" class="attributes-summary-label">{{ part.label }}</span>
              {{ part.text }}
            </span>
            <span v-if="!summary.length" class="attributes-summary-item">未设置</span>
          </span>
        </button>
      </template>
      <div class="attributes-body">
        <span class="attributes-label">类型</span>
        <AppCombobox
          class="attributes-type"
          :model-value="attributes.type"
          :options="typeOptions"
          aria-label="类型"
          placeholder="选择或输入类型"
          @update:model-value="type => update({ type })"
        />
        <span class="attributes-label">别名</span>
        <AppTagInput
          :model-value="attributes.aliases"
          label="别名"
          placeholder="输入别名后回车"
          @update:model-value="aliases => update({ aliases })"
        />
        <span class="attributes-label">标签</span>
        <AppTagInput
          :model-value="attributes.tags"
          label="标签"
          placeholder="输入标签后回车"
          @update:model-value="tags => update({ tags })"
        />
        <span class="attributes-label">封面</span>
        <AppSelect
          class="attributes-type"
          aria-label="封面"
          :model-value="cover?.id ?? 'none'"
          @update:model-value="id => update({ cover: id === 'none' ? null : id })"
        >
          <AppSelectItem value="none">未设置</AppSelectItem>
          <AppSelectItem v-for="image in images" :key="image.id" :value="image.id">{{ image.title }}</AppSelectItem>
        </AppSelect>
      </div>
    </AppCollapsible>
    <button
      v-if="coverSrc"
      type="button"
      class="attributes-cover"
      :aria-label="`查看封面 ${cover!.title}`"
      :title="cover!.title"
      @click="preview = cover"
    >
      <img :src="coverSrc" alt="" />
    </button>
    <FilePreview v-model:entry="preview" :work-id="tab.workId" />
  </div>
</template>

<style scoped>
.attributes {
  position: relative;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--ui-font-size);
}
/* 缩略图不能嵌在折叠按钮里，按“箭头 + 属性”的宽度定位到标题后面，按钮内留出同宽空位。 */
.attributes-cover-space {
  flex-shrink: 0;
  width: 28px;
}
.attributes-cover {
  position: absolute;
  top: 3px;
  left: calc(12px + 16px + 8px + 2em + 8px);
  width: 28px;
  height: 24px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  background: var(--surface-muted);
  cursor: zoom-in;
}
.attributes-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.attributes-cover:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
}
.attributes-trigger {
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
.attributes-trigger:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}
.attributes-title {
  flex-shrink: 0;
  color: var(--foreground);
}
.attributes-chevron {
  flex-shrink: 0;
}
.attributes-summary {
  display: flex;
  gap: 16px;
  justify-content: flex-end;
  min-width: 0;
  max-width: 70%;
  margin-left: auto;
  overflow: hidden;
}
.attributes-summary-item {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attributes-summary-label {
  margin-right: 4px;
  opacity: 0.7;
}
.attributes :deep(.app-collapsible-content) {
  padding: 0;
}
.attributes-body {
  display: grid;
  grid-template-columns: 48px minmax(0, 560px);
  gap: 8px 12px;
  align-items: center;
  padding: 4px 16px 12px 36px;
}
.attributes-label {
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
/* 组件库把 class 落在内部节点上，需穿透 scoped 才能生效。 */
.attributes-body :deep(.attributes-type) {
  width: 200px;
}
</style>
