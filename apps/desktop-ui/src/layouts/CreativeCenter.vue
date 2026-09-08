<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import { defineAsyncComponent, watch } from 'vue';

import { AppScrollArea } from '@/components/AppScrollArea';
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
  () => [navigation.center, workspace.rootPath],
  () => {
    if (!workspace.rootPath) navigation.center = 'editor';
    else if (navigation.center !== 'editor') void library.load();
  },
  { immediate: true }
);
</script>
<template>
  <TabsRoot v-model="navigation.center" class="creative-center">
    <AppScrollArea orientation="horizontal" class="creative-center-strip">
      <TabsList aria-label="作品视图" class="creative-center-tabs">
        <TabsTrigger value="editor">正文</TabsTrigger>
        <TabsTrigger value="library" :disabled="!workspace.rootPath">资料库</TabsTrigger>
        <TabsTrigger value="timeline" :disabled="!workspace.rootPath">故事时间线</TabsTrigger>
        <TabsTrigger value="relationships" :disabled="!workspace.rootPath">角色关系</TabsTrigger>
      </TabsList>
    </AppScrollArea>
    <TabsContent value="editor" force-mount v-show="navigation.center === 'editor'" class="creative-center-content"
      ><EditorGroup
    /></TabsContent>
    <TabsContent value="library" class="creative-center-content"
      ><AssetLibrary :key="workspace.rootPath ?? ''"
    /></TabsContent>
    <TabsContent value="timeline" class="creative-center-content"
      ><StoryTimeline :key="workspace.rootPath ?? ''"
    /></TabsContent>
    <TabsContent value="relationships" class="creative-center-content"
      ><CharacterGraph :key="workspace.rootPath ?? ''"
    /></TabsContent>
  </TabsRoot>
</template>
<style scoped lang="scss">
.creative-center {
  @apply flex min-h-0 min-w-0 flex-1 flex-col;
  container-type: inline-size;
}
.creative-center-strip {
  @apply h-9 shrink-0 border-b;
  border-color: var(--border-subtle);
  background: var(--surface-acrylic-subtle);
}
.creative-center-tabs {
  @apply flex h-9 w-max min-w-full items-stretch gap-1 px-2;
}
.creative-center-tabs > button {
  @apply shrink-0 border-0 border-b-2 border-transparent bg-transparent px-3 outline-none disabled:opacity-45;
  font-size: var(--ui-font-size);
  color: var(--muted-foreground);
}
.creative-center-tabs > button[data-state='active'] {
  border-bottom-color: var(--primary-solid);
  color: var(--foreground);
}
.creative-center-tabs > button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
.creative-center-content {
  @apply flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none;
}
</style>
