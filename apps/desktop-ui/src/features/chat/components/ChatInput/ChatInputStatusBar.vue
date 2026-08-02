<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

const props = defineProps<{
  modelLabel: string;
  workspaceLabel: string;
}>();

const emit = defineEmits<{
  openSettings: [section: 'workspace' | 'llm'];
}>();
</script>

<template>
  <div class="chat-status-bar">
    <AppTooltip text="打开模型设置" side="top">
      <AppButton
        variant="ghost"
        size="xs"
        class="chat-status-item"
        type="button"
        aria-label="打开模型设置"
        @click="emit('openSettings', 'llm')"
      >
        <span class="i-mingcute-ai-line" aria-hidden="true" />
        <span class="chat-status-text">{{ props.modelLabel }}</span>
      </AppButton>
    </AppTooltip>
    <span class="chat-status-divider" aria-hidden="true" />
    <AppTooltip text="打开工作区设置" side="top">
      <AppButton
        variant="ghost"
        size="xs"
        class="chat-status-item"
        type="button"
        aria-label="打开工作区设置"
        @click="emit('openSettings', 'workspace')"
      >
        <span class="i-mingcute-folder-line" aria-hidden="true" />
        <span class="chat-status-text">{{ props.workspaceLabel }}</span>
      </AppButton>
    </AppTooltip>
  </div>
</template>

<style scoped lang="scss">
.chat-status-bar {
  @apply mt-1.5 flex select-none items-center gap-1 px-1 text-xs;

  color: var(--muted-foreground);
}

.chat-status-item {
  @apply min-w-0 flex-1 justify-start;
}

.chat-status-text {
  @apply min-w-0 truncate;
}

.chat-status-divider {
  @apply h-3 w-px shrink-0;

  background: var(--input-border);
}
</style>
