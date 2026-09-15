<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppListItem } from '@/components/AppListItem';
import { AppPanel } from '@/components/AppPanel';
import { AppTooltip } from '@/components/AppTooltip';
import { AssetContextMenu, useAssetStore } from '@/features/assets';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

const library = useLibraryStore();
const assets = useAssetStore();
const editor = useEditorStore();
const query = ref('');
const groups = computed(() =>
  [
    { label: '观察笔记', role: 'notes' },
    { label: '章节与近况摘要', role: 'summaries' }
  ].map(group =>
    Object.assign({}, group, {
      items: library.assets.filter(
        asset =>
          asset.role === group.role &&
          `${asset.title} ${asset.excerpt}`.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())
      )
    })
  )
);
const proposals = computed(() =>
  assets.proposals.filter(item =>
    `${item.title} ${item.reason}`.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())
  )
);
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  void assets.refresh();
  if (hasDesktopApi()) unsubscribe = getDesktopApi().memory.onPendingChanged(() => void assets.refresh());
});
onBeforeUnmount(() => unsubscribe?.());
</script>
<template>
  <AppPanel class="memory-panel" title="记忆" aria-label="作品记忆">
    <template #actions>
      <AppTooltip text="刷新记忆"
        ><AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="刷新记忆"
          :disabled="library.loading"
          @click="assets.refresh"
          ><span class="i-mingcute-refresh-3-line" /></AppButton
      ></AppTooltip>
    </template>
    <template #toolbar>
      <div class="memory-filter">
        <AppInput v-model="query" aria-label="筛选记忆" placeholder="筛选记忆"
          ><template #prefix><span class="i-mingcute-search-line" /></template
        ></AppInput>
      </div>
    </template>
    <div class="memory-list">
      <p v-if="assets.error || library.error" role="alert">{{ assets.error || library.error }}</p>
      <details open>
        <summary>
          <span class="i-mingcute-right-line memory-chevron" aria-hidden="true" />
          <strong>待确认提议</strong><span>{{ proposals.length }}</span>
        </summary>
        <AppListItem
          v-for="proposal in proposals"
          :key="proposal.id"
          class="memory-row"
          :title="proposal.title"
          :description="proposal.reason"
          :meta="proposal.targetPath"
          @click="assets.inspect(proposal.id)"
        />
        <p v-if="!proposals.length">没有待确认提议</p>
      </details>
      <details v-for="group in groups" :key="group.role" open>
        <summary>
          <span class="i-mingcute-right-line memory-chevron" aria-hidden="true" />
          <strong>{{ group.label }}</strong
          ><span>{{ group.items.length }}</span>
        </summary>
        <AssetContextMenu v-for="asset in group.items" :key="asset.sourcePath" :asset="asset">
          <AppListItem
            class="memory-row"
            :title="asset.title"
            :description="asset.excerpt"
            :meta="asset.sourcePath"
            :selected="editor.activeTab?.path === asset.sourcePath"
            @click="editor.openDocument(asset.sourcePath)"
          />
        </AssetContextMenu>
        <p v-if="!group.items.length">暂无{{ group.label }}</p>
      </details>
    </div>
  </AppPanel>
</template>
<style scoped lang="scss">
.memory-filter {
  @apply p-3;
}
summary {
  @apply flex min-h-9 cursor-pointer items-center gap-2 border-b px-3 py-2;
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
summary strong {
  @apply min-w-0 flex-1 font-semibold;
  color: var(--foreground);
}
summary::marker {
  content: '';
}
.memory-chevron {
  @apply size-3.5 shrink-0;
}
details[open] > summary .memory-chevron {
  transform: rotate(90deg);
}
p {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
p {
  @apply m-0 px-4 py-5;
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--destructive);
}
</style>
