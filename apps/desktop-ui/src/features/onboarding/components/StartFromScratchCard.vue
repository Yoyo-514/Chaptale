<script setup lang="ts">
import { AppButton } from '@/components/AppButton';

defineProps<{ busy: boolean }>();
const emit = defineEmits<{ start: [] }>();
</script>

<template>
  <aside class="start-guide" aria-label="长篇的第一步">
    <p class="start-guide-title">长篇的第一步</p>
    <p class="start-guide-body">
      第一章还空着。先别急着动笔，让<strong>故事策划</strong>陪你把要写的故事理成一份蓝图：题材、核心冲突、人物动机、结局方向。
    </p>
    <AppButton variant="primary" :disabled="busy" @click="emit('start')">
      <span class="i-mingcute-chat-1-line" aria-hidden="true" />{{ busy ? '正在准备…' : '帮我理清这个故事' }}
    </AppButton>
  </aside>
</template>

<style scoped lang="scss">
.start-guide {
  @apply mx-4 mt-3 flex shrink-0 flex-col items-start gap-2 border px-4 py-3;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  border-radius: var(--radius-overlay);
}

.start-guide-title {
  @apply m-0 font-medium;
}

.start-guide-body {
  @apply m-0;
  color: var(--muted-foreground);
}

.start-guide-body strong {
  color: var(--foreground);
  font-weight: 500;
}
</style>
