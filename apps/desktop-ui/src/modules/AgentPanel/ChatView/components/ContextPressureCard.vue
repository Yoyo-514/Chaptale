<script setup lang="ts">
import type { MemoryContextPressureStatus } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';

const props = defineProps<{
  status: MemoryContextPressureStatus;
  isCompacting: boolean;
}>();

const emit = defineEmits<{
  compact: [];
  dismiss: [];
}>();

function percentLabel(): string {
  return `${Math.round(props.status.percent ?? 0)}%`;
}
</script>

<template>
  <section class="context-pressure-card" aria-label="上下文压缩建议">
    <span class="i-mingcute-compress-line context-pressure-icon" aria-hidden="true" />
    <p class="context-pressure-copy">
      <strong>上下文已使用 {{ percentLabel() }}</strong>
      <span>压缩会保留关键设定、决策和未决事项，再继续对话。</span>
    </p>
    <AppButton variant="ghost" size="xs" type="button" :disabled="props.isCompacting" @click="emit('dismiss')">
      稍后
    </AppButton>
    <AppButton variant="primary" size="xs" type="button" :disabled="props.isCompacting" @click="emit('compact')">
      {{ props.isCompacting ? '正在压缩…' : '压缩后继续' }}
    </AppButton>
  </section>
</template>

<style scoped lang="scss">
.context-pressure-card {
  @apply flex items-center gap-2 px-3 py-2 text-sm;

  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}

.context-pressure-icon {
  @apply size-4 shrink-0;

  color: var(--accent-foreground);
}

.context-pressure-copy {
  @apply m-0 flex min-w-0 flex-1 flex-col;

  span {
    @apply truncate text-xs;

    color: var(--muted-foreground);
  }
}
</style>
