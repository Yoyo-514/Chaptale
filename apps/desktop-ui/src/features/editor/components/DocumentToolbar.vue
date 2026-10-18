<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';

const props = defineProps<{
  path: string;
  large: boolean;
  hasMetadata: boolean;
  showOutline: boolean;
  dirty?: boolean;
  saving?: boolean;
}>();
const emit = defineEmits<{
  outline: [];
  metadata: [];
  save: [];
  find: [];
  reload: [];
}>();

type ToolId = 'outline' | 'metadata' | 'save' | 'find' | 'reload';
type Tool = {
  id: ToolId;
  label: string;
  icon: string;
  shortcut?: string;
  separatorBefore?: boolean;
  disabled?: boolean;
};

/** 写作时只看到正文；文档工具都收进「…」菜单，按使用频率排列。 */
const tools = computed<Tool[]>(() => [
  ...(props.large
    ? []
    : [
        {
          id: 'outline',
          label: props.showOutline ? '隐藏标题大纲' : '标题大纲',
          icon: 'i-mingcute-list-check-line'
        } as Tool,
        ...(props.hasMetadata
          ? [{ id: 'metadata', label: '折叠或展开元数据', icon: 'i-mingcute-braces-line' } as Tool]
          : []),
        {
          id: 'save',
          label: '保存文件',
          icon: 'i-mingcute-save-line',
          shortcut: 'Ctrl+S',
          separatorBefore: true,
          disabled: !props.dirty || props.saving
        } as Tool
      ]),
  {
    id: 'find',
    label: '在文档中查找',
    icon: 'i-mingcute-search-line',
    shortcut: 'Ctrl+F',
    separatorBefore: props.large
  },
  { id: 'reload', label: '重新读取', icon: 'i-mingcute-refresh-3-line' }
]);

function select(id: ToolId) {
  if (id === 'outline') emit('outline');
  else if (id === 'metadata') emit('metadata');
  else if (id === 'save') emit('save');
  else if (id === 'find') emit('find');
  else emit('reload');
}
</script>

<template>
  <header class="document-toolbar">
    <span class="document-toolbar-spacer" />
    <span v-if="large" class="document-status"><span class="i-mingcute-lock-line" aria-hidden="true" />只读</span>
    <span v-else class="document-status" :class="{ 'is-dirty': dirty }" role="status">
      {{ saving ? '正在保存' : dirty ? '未保存' : '已保存' }}
    </span>
    <AppDropdownMenu align="end" content-size="sm">
      <template #trigger>
        <AppButton icon size="xs" variant="ghost" aria-label="文档操作">
          <span class="i-mingcute-more-1-line" aria-hidden="true" />
        </AppButton>
      </template>
      <p class="document-menu-path" :title="path">{{ path }}</p>
      <template v-for="tool in tools" :key="tool.id">
        <hr v-if="tool.separatorBefore" class="document-menu-separator" />
        <AppDropdownMenuItem
          density="sm"
          item-class="document-menu-item"
          :disabled="tool.disabled"
          :aria-keyshortcuts="tool.shortcut"
          @select="select(tool.id)"
        >
          <span :class="tool.icon" class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ tool.label }}</span>
          <kbd v-if="tool.shortcut" class="document-menu-shortcut" aria-hidden="true">{{ tool.shortcut }}</kbd>
        </AppDropdownMenuItem>
      </template>
    </AppDropdownMenu>
  </header>
</template>

<style scoped lang="scss">
.document-toolbar {
  @apply flex h-8 shrink-0 items-center gap-1 px-2;
  font-size: var(--ui-font-size);
  color: var(--muted-foreground);
}
.document-toolbar-spacer {
  @apply flex-1;
}
.document-status {
  @apply mr-1 inline-flex shrink-0 items-center gap-1;
  font-size: var(--ui-caption-size);
}
.document-status.is-dirty {
  color: var(--foreground);
}
.document-menu-path {
  @apply m-0 max-w-72 truncate px-2.5 pb-1.5 pt-1;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.document-menu-separator {
  @apply my-1 border-0 border-t;
  border-color: var(--border-subtle);
}
:global(.document-menu-item) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 13rem;
}
.document-menu-shortcut {
  @apply font-sans;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
</style>
