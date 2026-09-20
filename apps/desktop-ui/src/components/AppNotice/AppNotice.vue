<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'error' | 'warning' | 'info' | 'status' }>(), { tone: 'status' });
const icons = {
  error: 'i-mingcute-close-circle-line',
  warning: 'i-mingcute-warning-line',
  info: 'i-mingcute-information-line',
  status: ''
};
</script>

<template>
  <p class="app-notice" :class="`app-notice-${tone}`" :role="tone === 'error' ? 'alert' : 'status'">
    <span v-if="icons[tone]" :class="icons[tone]" class="app-notice-icon" aria-hidden="true" />
    <span class="app-notice-text"><slot /></span>
  </p>
</template>

<style lang="scss">
.app-notice {
  @apply m-0 flex items-start gap-1.5 px-3 py-1.5;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.app-notice-icon {
  @apply mt-0.5 size-3.5 shrink-0;
}
.app-notice-text {
  @apply min-w-0;
}
.app-notice-error {
  color: var(--destructive);
}
.app-notice-warning {
  color: var(--warning);
}
.app-notice-info {
  color: var(--foreground);
}
</style>
