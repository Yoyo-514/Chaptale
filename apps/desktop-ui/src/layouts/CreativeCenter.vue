<script setup lang="ts">
import { defineAsyncComponent, watch } from 'vue';

import { EditorGroup } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';

const AssetLibrary = defineAsyncComponent(() => import('@/features/assets/components/AssetLibrary.vue'));
const StoryTimeline = defineAsyncComponent(() => import('@/features/assets/components/StoryTimeline.vue'));
const CharacterGraph = defineAsyncComponent(() => import('@/features/assets/components/CharacterGraph.vue'));
const navigation = useWorkbenchStore();
const workspace = useWorkspaceStore();
const library = useLibraryStore();
watch(
  () => workspace.rootPath,
  () => navigation.resetViews()
);
watch(
  () => navigation.center,
  () => {
    if (!workspace.rootPath) navigation.resetViews();
    else if (navigation.center !== 'editor') void library.load();
  },
  { immediate: true }
);
</script>
<template>
  <div class="creative-center">
    <EditorGroup>
      <template #library><AssetLibrary :key="workspace.rootPath ?? ''" /></template>
      <template #timeline><StoryTimeline :key="workspace.rootPath ?? ''" /></template>
      <template #relationships><CharacterGraph :key="workspace.rootPath ?? ''" /></template>
    </EditorGroup>
  </div>
</template>
<style scoped lang="scss">
.creative-center {
  @apply flex min-h-0 min-w-0 flex-1 flex-col;
  container-type: inline-size;
}
</style>
