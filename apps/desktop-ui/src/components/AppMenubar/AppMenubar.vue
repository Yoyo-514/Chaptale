<script setup lang="ts">
import {
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarPortal,
  MenubarRoot,
  MenubarSeparator,
  MenubarTrigger
} from 'reka-ui';

import type { AppMenubarMenu } from './types';

defineProps<{
  menus: readonly AppMenubarMenu[];
}>();

const emit = defineEmits<{
  select: [itemId: string];
}>();
</script>

<template>
  <MenubarRoot class="app-menubar" aria-label="应用菜单">
    <MenubarMenu v-for="menu in menus" :key="menu.id">
      <MenubarTrigger class="app-menubar-trigger">{{ menu.label }}</MenubarTrigger>

      <MenubarPortal>
        <MenubarContent class="app-menubar-content" :side-offset="4" align="start">
          <template v-for="item in menu.items" :key="item.id">
            <MenubarSeparator v-if="item.separatorBefore" class="app-menubar-separator" />
            <MenubarItem
              class="app-menubar-item"
              :disabled="item.disabled"
              :data-item-id="item.id"
              @select="emit('select', item.id)"
            >
              <span class="app-menubar-item-label">{{ item.label }}</span>
              <span v-if="item.shortcut" class="app-menubar-shortcut">{{ item.shortcut }}</span>
            </MenubarItem>
          </template>
        </MenubarContent>
      </MenubarPortal>
    </MenubarMenu>
  </MenubarRoot>
</template>

<style lang="scss">
.app-menubar {
  @apply flex h-full items-center gap-0.5;

  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.app-menubar-trigger {
  @apply flex h-7 cursor-default items-center border-0 bg-transparent px-2 text-xs outline-none transition-colors duration-100;

  border-radius: var(--radius-control-sm);
  color: var(--titlebar-foreground);
}

.app-menubar-trigger:hover,
.app-menubar-trigger[data-highlighted],
.app-menubar-trigger[data-state='open'] {
  background: var(--titlebar-control-hover);
}

.app-menubar-trigger:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.app-menubar-content {
  @apply z-$z-popover min-w-48 border p-1 shadow-$shadow-float;

  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
  color: var(--popover-foreground);
}

.app-menubar-item {
  @apply flex min-h-7 cursor-default items-center gap-4 px-2 py-1 text-xs outline-none;

  border-radius: var(--radius-control-sm);
}

.app-menubar-item[data-highlighted] {
  background: var(--surface-muted);
}

.app-menubar-item[data-disabled] {
  @apply pointer-events-none opacity-50;
}

.app-menubar-item-label {
  @apply min-w-0 flex-1;
}

.app-menubar-shortcut {
  @apply ml-auto shrink-0 pl-4 text-[11px];

  color: var(--muted-foreground);
}

.app-menubar-separator {
  @apply my-1 h-px;

  background: var(--border-subtle);
}
</style>
