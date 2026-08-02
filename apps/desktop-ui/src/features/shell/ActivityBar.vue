<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { useSettingsStore } from '@/features/settings';

const settingsStore = useSettingsStore();

const activities = [
  { id: 'workspace', label: '工作区', icon: 'i-mingcute-folder-2-line', available: true },
  { id: 'search', label: '搜索', icon: 'i-mingcute-search-line', available: false },
  { id: 'structure', label: '结构', icon: 'i-mingcute-list-check-line', available: false },
  { id: 'review', label: '审查', icon: 'i-mingcute-check-circle-line', available: false },
  { id: 'memory', label: '记忆', icon: 'i-mingcute-brain-line', available: false }
] as const;
</script>

<template>
  <aside class="activity-bar" aria-label="应用活动栏">
    <nav class="activity-bar-primary" aria-label="创作视图">
      <AppTooltip
        v-for="activity in activities"
        :key="activity.id"
        :text="activity.label"
        side="right"
        :side-offset="6"
      >
        <AppButton
          icon
          size="lg"
          variant="ghost"
          type="button"
          :selected="activity.id === 'workspace'"
          :disabled="!activity.available"
          :aria-current="activity.id === 'workspace' ? 'page' : undefined"
          :aria-label="activity.label"
        >
          <span :class="[activity.icon, 'size-5']" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </nav>

    <div class="activity-bar-spacer" />

    <AppTooltip text="设置" side="right" :side-offset="6" with-arrow>
      <AppButton icon size="lg" variant="ghost" type="button" aria-label="打开设置" @click="settingsStore.openPanel()">
        <span class="i-mingcute-settings-3-line size-5" aria-hidden="true" />
      </AppButton>
    </AppTooltip>
  </aside>
</template>

<style scoped lang="scss">
.activity-bar {
  @apply flex h-full w-12 shrink-0 flex-col items-center border-r px-1.5 py-2;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.activity-bar-primary {
  @apply flex flex-col items-center gap-1;
}

.activity-bar-spacer {
  @apply flex-1;
}
</style>
