<script setup lang="ts">
import { ref, watch } from 'vue';

import { OnboardingDialog } from '@/features/onboarding';
import { SettingsPanel, useSettingsStore } from '@/features/settings';
import { ActivityBar, StatusBar, TextContextMenu, TitleBar } from '@/features/shell';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore, WorkspaceSyncDialog } from '@/features/workspace';

import WorkbenchLayout from './WorkbenchLayout.vue';
const navigation = useWorkbenchStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const settingsMounted = ref(false);
watch(
  () => settings.isOpen,
  open => {
    if (open) settingsMounted.value = true;
  },
  { immediate: true }
);
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
      <SettingsPanel v-if="settingsMounted" />
      <WorkspaceSyncDialog v-if="workspace.syncOpen" />
      <OnboardingDialog />
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
