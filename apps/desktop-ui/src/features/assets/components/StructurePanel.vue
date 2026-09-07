<script setup lang="ts">
import { TabsRoot, TabsList, TabsTrigger } from 'reka-ui';
import { computed, onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useTemplateStore } from '@/features/templates';

import { assetKindLabel, assetViews, groupAssets, isUnclassified } from '../presentation';
import { useAssetStore } from '../store';

const assets = useAssetStore();
const library = useLibraryStore();
const editor = useEditorStore();
const templates = useTemplateStore();
const groups = computed(() =>
  groupAssets(library.assets, assets.view, assets.mode, assets.query, assets.includeArchived)
);
const conflicts = computed(
  () => library.snapshot?.diagnostics.filter(item => item.code === 'conflict-copy-skipped') ?? []
);
const diagnostics = computed(
  () => library.snapshot?.diagnostics.filter(item => item.code !== 'conflict-copy-skipped') ?? []
);
onMounted(() => void assets.refresh());
</script>
<template>
  <section class="structure-panel" aria-label="作品结构">
    <header>
      <h2>结构</h2>
      <AppTooltip text="新建资产"
        ><AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="新建资产"
          @click="templates.openCreate(assetViews.find(item => item.id === assets.view)?.template)"
        >
          <span class="i-mingcute-add-line" /> </AppButton
      ></AppTooltip>
      <AppTooltip text="刷新资产"
        ><AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="刷新资产"
          :disabled="library.loading"
          @click="assets.refresh"
          ><span class="i-mingcute-refresh-3-line" /></AppButton
      ></AppTooltip>
    </header>
    <TabsRoot v-model="assets.view" class="structure-tabs">
      <AppScrollArea orientation="horizontal" class="structure-tab-scroll">
        <TabsList aria-label="资产类型" class="structure-tab-list">
          <TabsTrigger v-for="item in assetViews" :key="item.id" :value="item.id" class="structure-tab">{{
            item.label
          }}</TabsTrigger>
        </TabsList>
      </AppScrollArea>
    </TabsRoot>
    <div class="structure-filters">
      <AppInput v-model="assets.query" aria-label="筛选资产" placeholder="筛选资产">
        <template #prefix><span class="i-mingcute-search-line" /></template>
        <template v-if="assets.query" #suffix
          ><AppButton icon size="xs" variant="ghost" aria-label="清除资产筛选" @click="assets.query = ''"
            ><span class="i-mingcute-close-line" /></AppButton
        ></template>
      </AppInput>
      <div class="structure-options">
        <div role="group" aria-label="资产排列" class="structure-modes">
          <AppTooltip text="目录视图"
            ><AppButton
              icon
              size="xs"
              variant="ghost"
              aria-label="目录视图"
              :selected="assets.mode === 'directory'"
              :aria-pressed="assets.mode === 'directory'"
              @click="assets.mode = 'directory'"
              ><span class="i-mingcute-folder-2-line" /></AppButton
          ></AppTooltip>
          <AppTooltip text="分组视图"
            ><AppButton
              icon
              size="xs"
              variant="ghost"
              aria-label="分组视图"
              :selected="assets.mode === 'grouped'"
              :aria-pressed="assets.mode === 'grouped'"
              @click="assets.mode = 'grouped'"
              ><span class="i-mingcute-grid-line" /></AppButton
          ></AppTooltip>
        </div>
        <label
          ><AppCheckbox
            :model-value="assets.includeArchived"
            @update:model-value="assets.includeArchived = $event === true"
          />包含归档</label
        >
      </div>
    </div>
    <AppScrollArea class="structure-body">
      <p v-if="library.error || assets.error" class="structure-error" role="alert">
        {{ library.error || assets.error }}
      </p>
      <p v-if="!groups.length" class="structure-empty" role="status">
        {{ library.loading ? '正在读取' : '没有匹配资产' }}
      </p>
      <details v-for="group in groups" :key="group.label" open class="structure-group">
        <summary>
          <span>{{ group.label }}</span
          ><span>{{ group.assets.length }}</span>
        </summary>
        <ul>
          <li v-for="asset in group.assets" :key="asset.sourcePath">
            <AppButton
              variant="ghost"
              class="structure-row"
              :selected="editor.activeTab?.path === asset.sourcePath"
              :aria-label="`打开资产 ${asset.title} ${asset.sourcePath}`"
              @click="assets.open(asset.sourcePath)"
            >
              <span class="i-mingcute-document-line structure-file-icon" aria-hidden="true" />
              <span class="structure-copy"
                ><span>{{ asset.title }}</span
                ><small>{{
                  assets.mode === 'grouped'
                    ? asset.sourcePath
                    : isUnclassified(asset)
                      ? '未分类'
                      : asset.status === 'final'
                        ? '已定稿'
                        : assetKindLabel(asset.kind)
                }}</small></span
              >
              <span
                v-if="asset.links.some(link => link.status === 'missing' || link.status === 'ambiguous')"
                class="i-mingcute-warning-line structure-warning"
                aria-label="含未解决引用"
              />
            </AppButton>
          </li>
        </ul>
      </details>
      <details v-if="conflicts.length" open class="structure-group structure-conflicts">
        <summary>
          冲突待处理 <span>{{ conflicts.length }}</span>
        </summary>
        <AppButton
          v-for="item in conflicts"
          :key="item.sourcePath"
          variant="ghost"
          class="structure-conflict"
          @click="item.sourcePath && editor.openDocument(item.sourcePath)"
          >{{ item.sourcePath }}</AppButton
        >
      </details>
      <details v-if="diagnostics.length" class="structure-group">
        <summary>
          索引诊断 <span>{{ diagnostics.length }}</span>
        </summary>
        <p v-for="(item, index) in diagnostics" :key="index" class="structure-error">
          {{ item.sourcePath }} {{ item.message }}
        </p>
      </details>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.structure-panel {
  @apply flex h-full min-h-0 min-w-0 flex-col;
  font-size: var(--ui-font-size);
}
header {
  @apply flex h-9 shrink-0 items-center gap-1 border-b px-3;
  border-color: var(--border-subtle);
}
h2 {
  @apply m-0 flex-1 font-medium;
  font-size: var(--ui-font-size);
}
.structure-tab-scroll {
  @apply h-9;
}
.structure-tab-list {
  @apply flex h-9 w-max min-w-full items-stretch gap-1 border-b px-2;
  border-color: var(--border-subtle);
}
.structure-tab {
  @apply shrink-0 border-0 border-b-2 border-transparent bg-transparent px-2 outline-none;
  color: var(--muted-foreground);
  font-size: var(--ui-font-size);
}
.structure-tab[data-state='active'] {
  color: var(--foreground);
  border-bottom-color: var(--primary-solid);
}
.structure-tab:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
.structure-filters {
  @apply flex shrink-0 flex-col gap-2 border-b p-3;
  border-color: var(--border-subtle);
}
.structure-options {
  @apply flex flex-wrap items-center justify-between gap-2;
}
.structure-options label {
  @apply flex items-center gap-2;
  color: var(--muted-foreground);
}
.structure-modes {
  @apply flex gap-1;
}
.structure-body {
  @apply min-h-0 flex-1;
}
.structure-group summary {
  @apply flex min-h-8 cursor-pointer items-center justify-between gap-2 px-3 py-1.5;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
.structure-group summary::before {
  content: '+';
}
.structure-group[open] > summary::before {
  content: '-';
}
.structure-group summary span:first-child {
  @apply min-w-0 flex-1;
}
ul {
  @apply m-0 list-none p-0;
}
.structure-row {
  @apply flex w-full justify-start rounded-none border-0 px-3 py-2 text-left;
}
.structure-copy {
  @apply flex min-w-0 flex-1 flex-col gap-1;
  overflow-wrap: anywhere;
}
.structure-copy small {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-weight: 400;
}
.structure-file-icon {
  @apply size-4 shrink-0;
}
.structure-warning,
.structure-conflicts {
  color: var(--warning);
}
.structure-empty,
.structure-error {
  @apply m-0 p-3;
  overflow-wrap: anywhere;
  color: var(--muted-foreground);
}
.structure-error {
  color: var(--destructive);
}
.structure-conflict {
  @apply w-full justify-start rounded-none border-0 text-left;
}
</style>
