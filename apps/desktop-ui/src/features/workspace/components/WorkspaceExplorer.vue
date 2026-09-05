<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import { AppButton } from '@/components/AppButton';

import { useFileTreeStore } from '../file-tree/store';
import { useWorkspaceStore } from '../store';
const workspace = useWorkspaceStore();
const tree = useFileTreeStore();
const rows = computed(() => tree.visibleRows.value);
const selectedPath = computed({ get: () => tree.selectedPath.value, set: value => (tree.selectedPath.value = value) });
async function refresh() {
  tree.reset();
  await tree.load('', workspace.showInternalFiles);
}
onMounted(async () => {
  await workspace.refreshState();
  if (workspace.rootPath) await refresh();
});
watch(
  () => workspace.revision,
  async () => {
    tree.reset();
    if (workspace.rootPath) await refresh();
  }
);
</script>
<template>
  <div class="workspace-explorer">
    <header class="workbench-panel-header">
      <span>工作区</span
      ><AppButton icon size="sm" variant="ghost" aria-label="刷新文件树" @click="refresh"
        ><span class="i-mingcute-refresh-3-line"
      /></AppButton>
    </header>
    <div v-if="!workspace.rootPath" class="workbench-placeholder">
      <p>尚未打开工作区</p>
      <AppButton size="sm" @click="workspace.openWorkspace">打开工作区</AppButton>
    </div>
    <div v-else-if="tree.loading['']" class="workbench-placeholder"><p>正在读取文件…</p></div>
    <div v-else-if="tree.errors['']" class="workbench-placeholder">
      <p>{{ tree.errors[''] }}</p>
    </div>
    <div v-else role="tree" class="workspace-tree">
      <div
        v-for="entry in rows"
        :key="entry.relativePath"
        role="treeitem"
        :aria-level="entry.depth + 1"
        :aria-expanded="entry.kind === 'directory' ? entry.expanded : undefined"
        :aria-selected="selectedPath === entry.relativePath"
        tabindex="0"
        class="workspace-tree-row"
        @click="
          entry.kind === 'directory'
            ? tree.toggle(entry.relativePath, workspace.showInternalFiles)
            : (selectedPath = entry.relativePath)
        "
      >
        <span
          v-if="entry.kind === 'directory'"
          :class="entry.expanded ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
          aria-hidden="true"
        />
        <span
          :class="entry.kind === 'directory' ? 'i-mingcute-folder-2-line' : 'i-mingcute-file-line'"
          aria-hidden="true"
        /><span>{{ entry.name }}</span>
      </div>
    </div>
  </div>
</template>
