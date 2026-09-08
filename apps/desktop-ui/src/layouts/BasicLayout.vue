<script setup lang="ts">
import { SettingsPanel } from '@/features/settings';
import { ActivityBar, StatusBar, TextContextMenu, TitleBar } from '@/features/shell';
import { useWorkbenchStore } from '@/features/workbench';

import WorkbenchLayout from './WorkbenchLayout.vue';
const navigation = useWorkbenchStore();
</script>

<template>
  <TextContextMenu>
    <div class="basic-layout">
      <TitleBar />
      <div class="basic-layout-body">
        <ActivityBar />
        <WorkbenchLayout />
      </div>
      <StatusBar v-if="navigation.statusBarOpen && !navigation.focusMode" />
      <SettingsPanel />
    </div>
  </TextContextMenu>
</template>

<style scoped lang="scss">
.basic-layout {
  @apply relative flex h-full flex-col overflow-hidden;
}

.basic-layout-body {
  @apply flex min-h-0 flex-1 overflow-hidden;
}
</style>
