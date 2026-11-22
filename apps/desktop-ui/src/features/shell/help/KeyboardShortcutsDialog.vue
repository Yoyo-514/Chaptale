<script setup lang="ts">
import { computed } from 'vue';

import { AppDialog } from '@/components/AppDialog';
import type { AppMenubarMenu } from '@/components/AppMenubar';
import { AppScrollArea } from '@/components/AppScrollArea';

const props = defineProps<{ menus: readonly AppMenubarMenu[]; modifier: string }>();
const emit = defineEmits<{ close: [] }>();

const columns = computed(() => {
  const editing = new Set(['edit.find', 'edit.replace']);
  const fromMenu = (id: string) => {
    const menu = props.menus.find(group => group.id === id)!;
    return {
      label: menu.label,
      rows: menu.items.flatMap(item => (item.shortcut ? [{ id: item.id, label: item.label, keys: item.shortcut }] : []))
    };
  };
  const edit = fromMenu('edit');
  const view = fromMenu('view');
  return [
    [fromMenu('file'), { ...edit, rows: edit.rows.filter(row => !editing.has(row.id)) }],
    [
      { ...view, rows: [...view.rows, { id: 'view.exit-focus', label: '退出专注模式', keys: 'Esc' }] },
      {
        label: '会话',
        rows: [
          { id: 'send', label: '发送消息／插话', keys: 'Enter' },
          { id: 'newline', label: '换行', keys: 'Shift+Enter' },
          { id: 'follow-up', label: '稍后处理', keys: `${props.modifier}+Shift+Enter` }
        ]
      },
      {
        label: '编辑器',
        rows: [
          ...edit.rows.filter(row => editing.has(row.id)),
          { id: 'work-search', label: '全作品搜索', keys: `${props.modifier}+Shift+F` },
          { id: 'work-replace', label: '全作品替换', keys: `${props.modifier}+Shift+H` }
        ]
      }
    ]
  ];
});
</script>

<template>
  <AppDialog :open="true" title="快捷键一览" @update:open="emit('close')">
    <AppScrollArea
      class="shortcut-scroll"
      viewport-class="shortcut-viewport"
      type="auto"
      role="region"
      aria-label="快捷键列表"
    >
      <div class="shortcut-columns">
        <div v-for="(column, index) in columns" :key="index" class="shortcut-column">
          <section v-for="group in column" :key="group.label">
            <h3>{{ group.label }}</h3>
            <dl>
              <div v-for="row in group.rows" :key="row.id" class="shortcut-row">
                <dt>{{ row.label }}</dt>
                <dd><kbd>{{ row.keys }}</kbd></dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </AppScrollArea>
  </AppDialog>
</template>

<style scoped lang="scss">
.shortcut-scroll {
  @apply mt-3 flex flex-col;
}
.shortcut-scroll :deep(.shortcut-viewport) {
  @apply h-auto flex-1;
}
.shortcut-scroll :deep(.shortcut-viewport:focus-visible) {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.shortcut-columns {
  @apply grid gap-5 px-2 pb-1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.shortcut-column {
  @apply flex min-w-0 flex-col gap-4;
}
.shortcut-column h3 {
  @apply m-0 border-b pb-1.5 font-semibold;
  border-color: var(--border-subtle);
  font-size: var(--ui-font-size);
}
.shortcut-column dl {
  @apply m-0;
}
.shortcut-row {
  @apply flex min-h-7 items-center justify-between gap-2;
  font-size: var(--ui-font-size);
}
.shortcut-row dd {
  @apply m-0 shrink-0;
}
.shortcut-row kbd {
  @apply inline-block border px-1.5 py-0.5;
  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control-sm);
  font-family: inherit;
  font-size: var(--ui-caption-size);
  line-height: 1.25;
}
@media (max-width: 38rem) {
  .shortcut-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
