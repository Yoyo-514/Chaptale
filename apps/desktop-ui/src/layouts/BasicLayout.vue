<script setup lang="ts">
import { SettingsPanel } from '@/features/settings';
import { ActivityBar, StatusBar, TitleBar } from '@/features/shell';

import WorkbenchLayout from './WorkbenchLayout.vue';
</script>

<template>
  <div class="basic-layout">
    <TitleBar />
    <div class="basic-layout-body">
      <ActivityBar />
      <WorkbenchLayout />
    </div>
    <StatusBar />
    <SettingsPanel />
  </div>
</template>

<style scoped lang="scss">
.basic-layout {
  @apply relative flex h-full flex-col overflow-hidden;
}

.basic-layout-body {
  @apply flex min-h-0 flex-1 overflow-hidden;
}
</style>
