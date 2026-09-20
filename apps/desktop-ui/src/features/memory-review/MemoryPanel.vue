<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppInput } from '@/components/AppInput';
import { AppListItem } from '@/components/AppListItem';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel, AppPanelSection } from '@/components/AppPanel';
import { AppTooltip } from '@/components/AppTooltip';
import { AssetContextMenu, useAssetStore } from '@/features/assets';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

const library = useLibraryStore();
const assets = useAssetStore();
const editor = useEditorStore();
const query = ref('');
const needle = computed(() => query.value.trim().toLocaleLowerCase());
const groups = computed(() =>
  [
    { label: '观察笔记', role: 'notes', icon: 'i-mingcute-eye-line', empty: '结算或 Agent 会话中的观察会记在这里。' },
    {
      label: '章节与近况摘要',
      role: 'summaries',
      icon: 'i-mingcute-align-left-line',
      empty: '完成章节结算后生成摘要。'
    }
  ].map(group =>
    Object.assign({}, group, {
      items: library.assets.filter(
        asset =>
          asset.role === group.role && `${asset.title} ${asset.excerpt}`.toLocaleLowerCase().includes(needle.value)
      )
    })
  )
);
const proposals = computed(() =>
  assets.proposals.filter(item => `${item.title} ${item.reason}`.toLocaleLowerCase().includes(needle.value))
);
const total = computed(() => proposals.value.length + groups.value.reduce((sum, group) => sum + group.items.length, 0));
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  void assets.refresh();
  if (hasDesktopApi()) unsubscribe = getDesktopApi().memory.onPendingChanged(() => void assets.refresh());
});
onBeforeUnmount(() => unsubscribe?.());
</script>
<template>
  <AppPanel class="memory-panel" title="记忆" :count="total" aria-label="作品记忆">
    <template #actions>
      <AppTooltip text="刷新记忆" side="bottom" :side-offset="3">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="刷新记忆"
          :disabled="library.loading"
          @click="assets.refresh"
        >
          <span class="i-mingcute-refresh-3-line" />
        </AppButton>
      </AppTooltip>
    </template>
    <template #toolbar>
      <AppInput v-model="query" class="app-panel-toolbar-full" aria-label="筛选记忆" placeholder="筛选记忆">
        <template #prefix><span class="i-mingcute-search-line" /></template>
        <template v-if="query" #suffix>
          <AppButton icon size="xs" variant="ghost" aria-label="清除记忆筛选" @click="query = ''">
            <span class="i-mingcute-close-line" />
          </AppButton>
        </template>
      </AppInput>
    </template>

    <AppNotice v-if="assets.error || library.error" tone="error">{{ assets.error || library.error }}</AppNotice>
    <AppPanelSection class="memory-pending" title="待确认提议" :count="proposals.length">
      <AppListItem
        v-for="proposal in proposals"
        :key="proposal.id"
        class="memory-row"
        :title="proposal.title"
        :description="proposal.reason"
        :meta="proposal.targetPath"
        @click="assets.inspect(proposal.id)"
      >
        <template #leading
          ><span class="i-mingcute-inbox-2-line size-4 memory-pending-icon" aria-hidden="true"
        /></template>
      </AppListItem>
      <p v-if="!proposals.length" class="memory-empty">{{ query ? '没有匹配的提议' : '没有待确认提议' }}</p>
    </AppPanelSection>
    <AppPanelSection v-for="group in groups" :key="group.role" :title="group.label" :count="group.items.length">
      <AssetContextMenu v-for="asset in group.items" :key="asset.sourcePath" :asset="asset">
        <AppListItem
          class="memory-row"
          :title="asset.title"
          :description="asset.excerpt"
          :meta="asset.sourcePath"
          :selected="editor.activeTab?.path === asset.sourcePath"
          @click="editor.openDocument(asset.sourcePath)"
        >
          <template #leading><span :class="group.icon" class="size-4" aria-hidden="true" /></template>
        </AppListItem>
      </AssetContextMenu>
      <p v-if="!group.items.length" class="memory-empty">{{ query ? `没有匹配的${group.label}` : group.empty }}</p>
    </AppPanelSection>
    <AppEmptyState
      v-if="!library.loading && !total && !query && !library.assets.length"
      icon="i-mingcute-brain-line"
      title="记忆会随写作积累"
      description="Agent 的观察笔记与章节摘要都会落在作品目录里，可随时查看与修改。"
    />
  </AppPanel>
</template>
<style scoped lang="scss">
.memory-pending-icon {
  color: var(--warning);
}
.memory-empty {
  @apply m-0 px-5 py-2;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  overflow-wrap: anywhere;
}
.memory-row {
  @apply pl-5;
}
</style>
