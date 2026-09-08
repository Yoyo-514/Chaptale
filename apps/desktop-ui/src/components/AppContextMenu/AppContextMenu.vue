<script setup lang="ts">
import { ContextMenuContent, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui';
import { computed } from 'vue';

import { useOverlayLayer } from '@/composables';

import AppContextMenuItems from './AppContextMenuItems.vue';
import type { AppContextMenuItem } from './types';

defineProps<{ items: readonly AppContextMenuItem[] }>();
const emit = defineEmits<{ prepare: [event: MouseEvent]; select: [id: string] }>();
const layer = useOverlayLayer();
const style = computed(() => ({ zIndex: `var(--z-${layer})` }));
function keyboard(event: KeyboardEvent) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  if (!(event.target instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = event.target.getBoundingClientRect();
  event.target.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 16, clientY: rect.bottom })
  );
}
</script>
<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child @contextmenu.stop="emit('prepare', $event)" @keydown="keyboard"
      ><slot
    /></ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent
        v-if="items.length"
        class="app-context-content"
        :style="style"
        :collision-padding="8"
        @close-auto-focus.prevent
      >
        <AppContextMenuItems :items="items" @select="emit('select', $event)" />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
<style lang="scss">
.app-context-content {
  @apply z-$z-popover flex min-w-52 flex-col gap-0.5 border p-1 shadow-$shadow-float outline-none;
  max-width: min(360px, calc(100vw - 16px));
  max-height: var(--reka-context-menu-content-available-height);
  overflow: auto;
  background: var(--popover);
  color: var(--popover-foreground);
  border-radius: var(--radius-control);
  font-size: var(--ui-font-size);
}
.app-context-item {
  @apply relative flex min-h-8 cursor-default select-none items-center gap-5 rounded-1 pl-8 pr-2 outline-none;
}
.app-context-item[data-highlighted] {
  background: var(--surface-hover);
}
.app-context-item[data-disabled] {
  @apply pointer-events-none opacity-45;
}
.app-context-item.is-danger {
  color: var(--destructive);
}
.app-context-icon {
  @apply absolute left-2 top-1/2 size-4 -translate-y-1/2;
}
.app-context-label {
  @apply min-w-0 flex-1;
  overflow-wrap: anywhere;
}
.app-context-shortcut {
  @apply shrink-0;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.app-context-separator {
  @apply my-1 h-px;
  background: var(--border-subtle);
}
</style>
