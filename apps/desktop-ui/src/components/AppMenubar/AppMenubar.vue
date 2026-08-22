<script setup lang="ts">
import {
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarPortal,
  MenubarRoot,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
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

            <MenubarSub v-if="item.items">
              <MenubarSubTrigger class="app-menubar-item" :disabled="item.disabled" :data-item-id="item.id">
                <span class="app-menubar-item-label">{{ item.label }}</span>
                <span class="i-mingcute-right-line app-menubar-sub-chevron" aria-hidden="true" />
              </MenubarSubTrigger>

              <MenubarPortal>
                <MenubarSubContent class="app-menubar-content" :side-offset="2" :align-offset="-4">
                  <MenubarItem
                    v-for="child in item.items ?? []"
                    :key="child.id"
                    class="app-menubar-item"
                    :disabled="child.disabled"
                    :data-item-id="child.id"
                    @select="emit('select', child.id)"
                  >
                    <span
                      v-if="child.checked !== undefined"
                      class="app-menubar-item-check"
                      :class="child.checked && 'i-mingcute-check-line'"
                      aria-hidden="true"
                    />
                    <span class="app-menubar-item-label">{{ child.label }}</span>
                    <span v-if="child.shortcut" class="app-menubar-shortcut">{{ child.shortcut }}</span>
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarPortal>
            </MenubarSub>

            <MenubarItem
              v-else
              class="app-menubar-item"
              :disabled="item.disabled"
              :data-item-id="item.id"
              @select="emit('select', item.id)"
            >
              <span
                v-if="item.checked !== undefined"
                class="app-menubar-item-check"
                :class="item.checked && 'i-mingcute-check-line'"
                aria-hidden="true"
              />
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
  background: var(--surface-hover);
}

// 子菜单展开期间触发项保持高亮，否则鼠标移进子菜单后父项看着像已经离开了。
.app-menubar-item[data-state='open'] {
  background: var(--surface-hover);
}

.app-menubar-item[data-disabled] {
  @apply pointer-events-none opacity-50;
}

// 固定宽度的勾位：未选中时留白，同组各项的文字才对得齐。
.app-menubar-item-check {
  @apply size-3.5 shrink-0;

  color: var(--primary-solid);
}

.app-menubar-sub-chevron {
  @apply ml-auto shrink-0 text-sm;

  color: var(--muted-foreground);
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
