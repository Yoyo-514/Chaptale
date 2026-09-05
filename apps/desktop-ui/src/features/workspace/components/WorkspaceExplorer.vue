<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual';
import { computed, onMounted, watch } from 'vue';
import { ref } from 'vue';

import { AppButton } from '@/components/AppButton';

import { useFileTreeStore } from '../file-tree/store';
import { useWorkspaceStore } from '../store';
const workspace = useWorkspaceStore();
const tree = useFileTreeStore();
const rows = computed(() => tree.visibleRows.value);
const selectedPath = computed({ get: () => tree.selectedPath.value, set: value => (tree.selectedPath.value = value) });
const scrollElementRef = ref<HTMLElement | null>(null);
const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollElementRef.value,
    estimateSize: () => 30,
    overscan: 8
  }))
);
const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());
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
    <div v-else ref="scrollElementRef" role="tree" class="workspace-tree">
      <div class="workspace-tree-spacer" :style="{ height: `${totalSize}px` }">
        <div
          v-for="item in virtualItems"
          :key="String(item.key)"
          :style="{ transform: `translateY(${item.start}px)` }"
          role="treeitem"
          :aria-level="(rows[item.index]?.depth ?? 0) + 1"
          :aria-expanded="rows[item.index]?.kind === 'directory' ? rows[item.index]?.expanded : undefined"
          :aria-selected="selectedPath === rows[item.index]?.relativePath"
          tabindex="0"
          class="workspace-tree-row"
          @click="
            rows[item.index] &&
            (rows[item.index]!.kind === 'directory'
              ? tree.toggle(rows[item.index]!.relativePath, workspace.showInternalFiles)
              : (selectedPath = rows[item.index]!.relativePath))
          "
        >
          <template v-if="rows[item.index]">
            <span
              v-if="rows[item.index]!.kind === 'directory'"
              :class="rows[item.index]!.expanded ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
              aria-hidden="true"
            />
            <span
              :class="rows[item.index]!.kind === 'directory' ? 'i-mingcute-folder-2-line' : 'i-mingcute-file-line'"
              aria-hidden="true"
            />
            <span>{{ rows[item.index]!.name }}</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
