<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTooltip } from '@/components/AppTooltip';
import AssetContextMenu from '@/features/assets/components/AssetContextMenu.vue';
import { useAssetStore } from '@/features/assets/store';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useWorkbenchStore } from '@/features/workbench';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

const library = useLibraryStore();
const assets = useAssetStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();
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
  <section class="memory-panel" aria-label="作品记忆">
    <header>
      <h2>记忆</h2>
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
      <AppTooltip text="隐藏侧栏"
        ><AppButton icon size="xs" variant="ghost" aria-label="隐藏侧栏" @click="navigation.sidebarOpen = false"
          ><span class="i-mingcute-close-line" /></AppButton
      ></AppTooltip>
    </header>
    <div class="memory-filter">
      <AppInput v-model="query" aria-label="筛选记忆" placeholder="筛选记忆"
        ><template #prefix><span class="i-mingcute-search-line" /></template
      ></AppInput>
    </div>
    <AppScrollArea class="memory-list">
      <p v-if="assets.error || library.error" role="alert">{{ assets.error || library.error }}</p>
      <details open>
        <summary>
          待确认提议 <span>{{ proposals.length }}</span>
        </summary>
        <AppButton
          v-for="proposal in proposals"
          :key="proposal.id"
          variant="ghost"
          class="memory-row"
          @click="assets.inspect(proposal.id)"
          ><strong>{{ proposal.title }}</strong
          ><span>{{ proposal.reason }}</span
          ><small>{{ proposal.targetPath }}</small></AppButton
        >
        <p v-if="!proposals.length">没有待确认提议</p>
      </details>
      <details v-for="group in groups" :key="group.role" open>
        <summary>
          {{ group.label }} <span>{{ group.items.length }}</span>
        </summary>
        <AssetContextMenu v-for="asset in group.items" :key="asset.sourcePath" :asset="asset">
          <AppButton variant="ghost" class="memory-row" @click="editor.openDocument(asset.sourcePath)"
            ><strong>{{ asset.title }}</strong
            ><span>{{ asset.excerpt }}</span
            ><small>{{ asset.sourcePath }}</small></AppButton
          >
        </AssetContextMenu>
        <p v-if="!group.items.length">暂无{{ group.label }}</p>
      </details>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.memory-panel {
  @apply flex h-full min-h-0 min-w-0 flex-col;
  font-size: var(--ui-font-size);
}
header {
  @apply flex h-9 shrink-0 items-center gap-1 border-b px-3;
  border-color: var(--border-subtle);
}
h2 {
  @apply m-0 flex-1 font-medium;
  font-size: inherit;
}
.memory-filter {
  @apply p-3;
}
.memory-list {
  @apply min-h-0 flex-1;
}
summary {
  @apply cursor-pointer border-y px-3 py-2;
  border-color: var(--border-subtle);
}
summary span {
  @apply float-right;
  color: var(--muted-foreground);
}
.memory-row {
  @apply h-auto w-full flex-col items-start gap-1 rounded-none border-0 border-b p-3 text-left;
  border-color: var(--border-subtle);
  white-space: normal;
  overflow-wrap: anywhere;
}
.memory-row strong {
  @apply font-medium;
}
.memory-row span {
  @apply line-clamp-3 font-normal;
}
.memory-row small,
p {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
p {
  @apply p-3;
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--destructive);
}
</style>
