<script setup lang="ts">
import type { SlashCommand } from '@chaptale/ipc-contract';

const props = defineProps<{
  commands: SlashCommand[];
  selectedIndex: number;
}>();

const emit = defineEmits<{
  select: [command: SlashCommand];
}>();
</script>

<template>
  <div class="chat-slash-command-menu" data-slot="chat-slash-command-menu" role="listbox" aria-label="命令">
    <button
      v-for="(command, index) in props.commands"
      :key="command.name"
      class="chat-slash-command-item"
      :class="{ 'chat-slash-command-item-selected': index === props.selectedIndex }"
      type="button"
      role="option"
      :aria-selected="index === props.selectedIndex"
      :data-selected="index === props.selectedIndex || undefined"
      @mousedown.prevent="emit('select', command)"
    >
      <span class="chat-slash-command-name">/{{ command.name }}</span>
      <span class="chat-slash-command-description">{{ command.description }}</span>
      <span v-if="command.argumentHint" class="chat-slash-command-hint">{{ command.argumentHint }}</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.chat-slash-command-menu {
  @apply absolute bottom-full left-0 z-$z-local-popover mb-2 flex max-h-64 w-full flex-col overflow-y-auto rounded-lg border p-1 shadow-$shadow-soft;

  background: var(--surface-elevated);
  border-color: var(--border);
}

.chat-slash-command-item {
  @apply grid w-full cursor-pointer grid-cols-[minmax(10rem,auto)_1fr_auto] items-center gap-3 rounded-md px-3 py-2 text-left text-sm;

  color: var(--foreground);
}

.chat-slash-command-item:hover {
  background: var(--accent-sakura);
}

.chat-slash-command-item-selected {
  background: var(--accent);
}

.chat-slash-command-name {
  @apply font-medium;

  color: var(--accent-foreground);
}

.chat-slash-command-description {
  @apply truncate;

  color: var(--muted-foreground);
}

.chat-slash-command-hint {
  @apply text-xs;

  color: var(--muted-foreground);
}
</style>
