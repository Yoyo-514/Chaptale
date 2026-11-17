<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

import { useCreationStore } from '@/features/creation';
import { useSettingsStore } from '@/features/settings';
import { ActivityBar, SettingsPanel, StatusBar, TextContextMenu, TitleBar } from '@/features/shell';
import { useWorkbenchStore } from '@/features/workbench';

import WorkbenchLayout from './WorkbenchLayout.vue';
const navigation = useWorkbenchStore();
const creation = useCreationStore();
const settings = useSettingsStore();
onMounted(() => {
  void settings.load();
});
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
        <ActivityBar v-if="!creation.libraryOpen" />
        <WorkbenchLayout />
      </div>
      <StatusBar v-if="navigation.statusBarOpen && !navigation.focusMode" />
      <SettingsPanel v-if="settingsMounted" />
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
