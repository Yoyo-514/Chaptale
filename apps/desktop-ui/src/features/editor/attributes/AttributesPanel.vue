<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ResourceAttributes } from '@chaptale/creation/contracts';

import { AppCollapsible } from '@/components/AppCollapsible';
import { AppCombobox } from '@/components/AppCombobox';
import { AppTagInput } from '@/components/AppTagInput';

import { useEditorStore } from '../store';
import type { EditorTab } from '../types';

const typeOptions = ['人物', '地点', '组织', '物品', '设定', '笔记'].map(value => ({ value, label: value }));

const props = defineProps<{ tab: EditorTab }>();
const editor = useEditorStore();
const open = ref(false);
const attributes = computed(() => props.tab.attributes!);
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
  <AppCollapsible v-model="open" class="attributes" variant="plain" aria-label="资料属性" role="region">
    <template #trigger>
      <button type="button" class="attributes-trigger" :aria-label="open ? '属性' : `属性 ${summaryText}`">
        <span
          :class="open ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
          class="attributes-chevron size-4"
          aria-hidden="true"
        />
        <span class="attributes-title">属性</span>
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
    </div>
  </AppCollapsible>
</template>

<style scoped>
.attributes {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
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
.attributes-type {
  width: 200px;
}
</style>
