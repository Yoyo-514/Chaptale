<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

import type { EditCommand } from '@chaptale/ipc-contract';

import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { useNotificationStore } from '@/features/notifications';
import { toErrorMessage } from '@/utils/desktop-api';
import { captureEditingTarget } from '@/utils/editing-target';

const items = ref<AppContextMenuItem[]>([]);
const anchor = ref<HTMLElement>();
let target: ReturnType<typeof captureEditingTarget> | undefined;
function prepare(event: MouseEvent) {
  if (event.defaultPrevented) return;
  target = captureEditingTarget(event.target);
  if (!target.text && !target.editable) return;
  event.preventDefault();
  items.value = [
    ...(target.editable
      ? [
          { id: 'undo', label: '撤销', icon: 'i-mingcute-back-line', shortcut: 'Ctrl+Z' },
          { id: 'redo', label: '重做', shortcut: 'Ctrl+Y' },
          { id: 'cut', label: '剪切', shortcut: 'Ctrl+X', disabled: !target.text, separatorBefore: true }
        ]
      : []),
    { id: 'copy', label: '复制', icon: 'i-mingcute-copy-2-line', shortcut: 'Ctrl+C', disabled: !target.text },
    ...(target.editable
      ? [
          { id: 'paste', label: '粘贴', shortcut: 'Ctrl+V' },
          { id: 'selectAll', label: '全选', shortcut: 'Ctrl+A', separatorBefore: true }
        ]
      : [])
  ];
  anchor.value?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY })
  );
}
function keyboard(event: KeyboardEvent) {
  if (event.defaultPrevented || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return;
  if (!(event.target instanceof HTMLElement)) return;
  event.preventDefault();
  const rect = event.target.getBoundingClientRect();
  event.target.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 12, clientY: rect.bottom })
  );
}
onMounted(() => {
  document.addEventListener('contextmenu', prepare);
  document.addEventListener('keydown', keyboard);
});
onBeforeUnmount(() => {
  document.removeEventListener('contextmenu', prepare);
  document.removeEventListener('keydown', keyboard);
});
async function execute(id: string) {
  try {
    await target?.execute(id as EditCommand);
  } catch (error) {
    useNotificationStore().error('编辑操作失败', toErrorMessage(error));
  }
}
</script>
<template>
  <slot />
  <AppContextMenu :items="items" @select="execute"
    ><span ref="anchor" class="text-menu-anchor" aria-hidden="true"
  /></AppContextMenu>
</template>
<style scoped>
.text-menu-anchor {
  position: fixed;
  width: 0;
  height: 0;
  pointer-events: none;
}
</style>
