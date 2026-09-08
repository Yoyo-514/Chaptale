<script setup lang="ts">
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuPortal
} from 'reka-ui';

import type { AppContextMenuItem } from './types';
defineProps<{ items: readonly AppContextMenuItem[] }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>
<template>
  <template v-for="item in items" :key="item.id">
    <ContextMenuSeparator v-if="item.separatorBefore" class="app-context-separator" />
    <ContextMenuSub v-if="item.items?.length">
      <ContextMenuSubTrigger class="app-context-item" :disabled="item.disabled">
        <span v-if="item.icon" :class="item.icon" class="app-context-icon" aria-hidden="true" />
        <span class="app-context-label">{{ item.label }}</span
        ><span class="i-mingcute-right-line size-4 shrink-0" aria-hidden="true" />
      </ContextMenuSubTrigger>
      <ContextMenuPortal>
        <ContextMenuSubContent class="app-context-content" :side-offset="4">
          <AppContextMenuItems :items="item.items" @select="emit('select', $event)" />
        </ContextMenuSubContent>
      </ContextMenuPortal>
    </ContextMenuSub>
    <ContextMenuItem
      v-else
      class="app-context-item"
      :class="{ 'is-danger': item.danger }"
      :disabled="item.disabled"
      :aria-label="item.label"
      :aria-keyshortcuts="item.shortcut?.replace('Ctrl', 'Control')"
      @select="emit('select', item.id)"
    >
      <span v-if="item.icon" :class="item.icon" class="app-context-icon" aria-hidden="true" />
      <span class="app-context-label">{{ item.label }}</span>
      <span v-if="item.shortcut" class="app-context-shortcut">{{ item.shortcut }}</span>
    </ContextMenuItem>
  </template>
</template>
