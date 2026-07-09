<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings';
import AppButton from '@/components/AppButton/AppButton.vue';
import AppTooltip from '@/components/AppTooltip/AppTooltip.vue';

const settingsStore = useSettingsStore();
</script>

<template>
  <aside class="activity-bar" aria-label="应用活动栏">
    <div class="activity-bar-spacer" />
    <AppTooltip text="设置" side="right" :side-offset="6" with-arrow>
      <AppButton icon size="lg" variant="ghost" type="button" aria-label="打开设置" @click="settingsStore.openPanel()">
        <span class="i-mingcute-settings-3-line size-6" aria-hidden="true" />
      </AppButton>
    </AppTooltip>
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
</style>
