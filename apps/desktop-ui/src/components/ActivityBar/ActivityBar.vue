<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings';

const settingsStore = useSettingsStore();
</script>

<template>
  <aside class="activity-bar" aria-label="应用活动栏">
    <div class="activity-bar-spacer" />
    <button class="activity-bar-button" type="button" aria-label="打开设置" @click="settingsStore.openPanel()">
      <span class="i-mingcute-settings-3-line" aria-hidden="true" />
    </button>
  </aside>
</template>

<style scoped lang="scss">
.activity-bar {
  @apply flex h-full w-12 shrink-0 flex-col items-center border-r px-2 py-3;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.activity-bar-spacer {
  @apply flex-1;
}

.activity-bar-button {
  @apply flex-center size-8 border text-base outline-none transition-colors duration-150;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--muted-foreground);
}

.activity-bar-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.activity-bar-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
