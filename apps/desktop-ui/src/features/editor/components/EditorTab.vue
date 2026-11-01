<script setup lang="ts">
import { TabsTrigger } from 'reka-ui';
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';

/** 编辑区的一个标签：正式文稿、审阅或历史，关闭按钮在未保存时显示圆点。 */
const props = defineProps<{
  kind: 'document' | 'review' | 'history' | 'check';
  /** TabsRoot 的选中值，也用于生成触发器 id。 */
  value: string;
  triggerId: string;
  title: string;
  selected: boolean;
  dirty?: boolean;
  busy?: boolean;
  /** 分栏时标出该标签所在位置。 */
  location?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const kinds = {
  document: { name: '', icon: '', dirtyNote: '未保存' },
  review: { name: '审阅', icon: 'i-mingcute-git-compare-line', dirtyNote: '手改未保存' },
  history: { name: '历史', icon: 'i-mingcute-history-line', dirtyNote: '' },
  check: { name: '核对', icon: 'i-mingcute-check-circle-line', dirtyNote: '' }
} as const;
const kind = computed(() => kinds[props.kind]);
const label = computed(
  () =>
    `${kind.value.name ? `${kind.value.name} ` : ''}${props.title}${props.dirty ? `（${kind.value.dirtyNote}）` : ''}`
);
</script>

<template>
  <div class="editor-tab-shell" :class="{ selected }">
    <TabsTrigger
      :id="triggerId"
      :value="value"
      class="editor-tab"
      :aria-label="label"
      :aria-busy="busy || undefined"
      :title="label"
      @keydown.delete.prevent="emit('close')"
    >
      <span v-if="kind.icon" class="tab-kind-icon" :class="kind.icon" aria-hidden="true" />
      <span class="tab-title">{{ title }}</span>
      <span v-if="location" class="tab-location">{{ location }}</span>
    </TabsTrigger>
    <AppButton
      icon
      size="xs"
      variant="ghost"
      class="editor-tab-close"
      :class="{ 'is-dirty': dirty }"
      :aria-label="`关闭${kind.name} ${title}`"
      :title="dirty ? `关闭（${kind.dirtyNote}）` : '关闭'"
      @click="emit('close')"
      ><span class="i-mingcute-close-line tab-close-icon" aria-hidden="true"
    /></AppButton>
  </div>
</template>

<style scoped>
.editor-tab-shell {
  display: flex;
  align-items: center;
  padding-inline: 4px;
  border-right: 1px solid var(--border-subtle);
  color: var(--muted-foreground);
}
.editor-tab-shell.selected {
  background: var(--background);
  color: var(--foreground);
}
.editor-tab-shell span[aria-hidden='true'] {
  display: block;
  width: 14px;
  height: 14px;
}
.editor-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 100%;
  max-width: 240px;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.editor-tab:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-kind-icon {
  flex-shrink: 0;
  color: var(--warning);
}
.tab-location {
  font-size: 12px;
  color: var(--muted-foreground);
}
.editor-tab-close {
  position: relative;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
}
.editor-tab-shell.selected .editor-tab-close,
.editor-tab-shell:hover .editor-tab-close,
.editor-tab-shell:focus-within .editor-tab-close,
.editor-tab-close.is-dirty {
  opacity: 1;
  pointer-events: auto;
}
.editor-tab-close.is-dirty::before {
  content: '';
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.editor-tab-close.is-dirty .tab-close-icon {
  visibility: hidden;
}
.editor-tab-shell:hover .editor-tab-close.is-dirty::before,
.editor-tab-close:focus-visible::before {
  display: none;
}
.editor-tab-shell:hover .editor-tab-close .tab-close-icon,
.editor-tab-close:focus-visible .tab-close-icon {
  visibility: visible;
}
</style>
