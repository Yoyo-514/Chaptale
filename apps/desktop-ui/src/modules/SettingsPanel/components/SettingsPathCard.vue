<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    value?: string | null;
    placeholder?: string;
    emphasis?: boolean;
  }>(),
  {
    value: undefined,
    placeholder: '读取中...',
    emphasis: false
  }
);

const displayValue = computed(() => props.value || props.placeholder);
</script>

<template>
  <div class="settings-path-card" :class="{ 'is-emphasis': props.emphasis }">
    <span class="settings-path-label">{{ props.label }}</span>
    <code class="settings-path-value">{{ displayValue }}</code>
  </div>
</template>

<style scoped lang="scss">
.settings-path-card {
  @apply flex min-w-0 flex-col gap-1 border px-3 py-2;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
}

.settings-path-card.is-emphasis {
  border-color: var(--primary);
}

.settings-path-label {
  @apply text-xs;

  color: var(--muted-foreground);
}

.settings-path-value {
  @apply break-all text-xs;

  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}
</style>
