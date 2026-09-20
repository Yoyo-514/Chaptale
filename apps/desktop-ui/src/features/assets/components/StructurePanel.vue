<script setup lang="ts">
import { TabsRoot, TabsList, TabsTrigger } from 'reka-ui';
import { computed, onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppInput } from '@/components/AppInput';
import { AppListItem } from '@/components/AppListItem';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel, AppPanelSection } from '@/components/AppPanel';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useTemplateStore } from '@/features/templates';
import { useWorkbenchStore, workspaceViews } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';

import { assetKindLabel, assetStatusLabel, assetViews, groupAssets, isUnclassified } from '../presentation';
import { useAssetStore } from '../store';

const assets = useAssetStore();
const library = useLibraryStore();
const editor = useEditorStore();
const templates = useTemplateStore();
const navigation = useWorkbenchStore();
const workspace = useWorkspaceStore();
const groups = computed(() =>
  groupAssets(library.assets, assets.view, assets.mode, assets.query, assets.includeArchived)
);
const conflicts = computed(
  () => library.snapshot?.diagnostics.filter(item => item.code === 'conflict-copy-skipped') ?? []
);
const diagnostics = computed(
  () => library.snapshot?.diagnostics.filter(item => item.code !== 'conflict-copy-skipped') ?? []
);
const currentView = computed(() => assetViews.find(item => item.id === assets.view));
/** 标签页已经写明类型，行尾只补标签没说的信息：分组模式给文件名，目录模式给状态或跨类型提示。 */
function rowMeta(asset: (typeof groups.value)[number]['assets'][number]) {
  if (assets.mode === 'grouped') return asset.sourcePath.split('/').pop() ?? asset.sourcePath;
  if (isUnclassified(asset)) return '未分类';
  if (asset.kind !== currentView.value?.kind) return assetKindLabel(asset.kind);
  return assetStatusLabel(asset.status);
}
onMounted(() => void assets.refresh());
</script>
<template>
  <AppPanel class="structure-panel" title="资料库" aria-label="资料库导航">
    <template #actions>
      <!-- 三个整页视图是资料库的「大门」，放在表头操作位；它们打开的是中央工作区而不是侧栏内容。 -->
      <nav class="library-views" aria-label="资料库视图">
        <AppTooltip v-for="view in workspaceViews" :key="view.id" :text="view.label" side="bottom" :side-offset="3">
          <AppButton
            icon
            size="xs"
            variant="ghost"
            :aria-label="`打开${view.label}`"
            :selected="navigation.center === view.id"
            :disabled="!workspace.rootPath"
            @click="navigation.openView(view.id)"
          >
            <span :class="view.icon" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </nav>
      <span class="library-actions-divider" aria-hidden="true" />
      <AppTooltip text="新建资产" side="bottom" :side-offset="3">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="新建资产"
          @click="templates.openCreate(currentView?.template)"
        >
          <span class="i-mingcute-add-line" />
        </AppButton>
      </AppTooltip>
    </template>
    <template #toolbar>
      <TabsRoot v-model="assets.view" class="app-panel-toolbar-full structure-tabs">
        <TabsList aria-label="资产类型" class="structure-tab-list">
          <TabsTrigger v-for="item in assetViews" :key="item.id" :value="item.id" class="structure-tab">{{
            item.label
          }}</TabsTrigger>
        </TabsList>
      </TabsRoot>
      <div class="app-panel-toolbar-full structure-filter">
        <AppInput v-model="assets.query" class="structure-filter-input" aria-label="筛选资产" placeholder="筛选资产">
          <template #prefix><span class="i-mingcute-search-line" /></template>
          <template v-if="assets.query" #suffix>
            <AppButton icon size="xs" variant="ghost" aria-label="清除资产筛选" @click="assets.query = ''">
              <span class="i-mingcute-close-line" />
            </AppButton>
          </template>
        </AppInput>
        <span class="structure-options" role="group" aria-label="资产排列">
          <AppTooltip text="目录视图" side="bottom" :side-offset="3">
            <AppButton
              icon
              size="xs"
              variant="ghost"
              aria-label="目录视图"
              :selected="assets.mode === 'directory'"
              :aria-pressed="assets.mode === 'directory'"
              @click="assets.mode = 'directory'"
            >
              <span class="i-mingcute-folder-2-line" />
            </AppButton>
          </AppTooltip>
          <AppTooltip text="分组视图" side="bottom" :side-offset="3">
            <AppButton
              icon
              size="xs"
              variant="ghost"
              aria-label="分组视图"
              :selected="assets.mode === 'grouped'"
              :aria-pressed="assets.mode === 'grouped'"
              @click="assets.mode = 'grouped'"
            >
              <span class="i-mingcute-grid-line" />
            </AppButton>
          </AppTooltip>
          <AppTooltip :text="assets.includeArchived ? '隐藏已归档' : '包含归档'" side="bottom" :side-offset="3">
            <AppButton
              icon
              size="xs"
              variant="ghost"
              aria-label="包含归档"
              :selected="assets.includeArchived"
              :aria-pressed="assets.includeArchived"
              @click="assets.includeArchived = !assets.includeArchived"
            >
              <span class="i-mingcute-archive-line" />
            </AppButton>
          </AppTooltip>
        </span>
      </div>
    </template>

    <AppNotice v-if="library.error || assets.error" tone="error">{{ library.error || assets.error }}</AppNotice>
    <AppEmptyState
      v-if="!groups.length"
      :icon="library.loading ? 'i-mingcute-loading-3-line' : 'i-mingcute-grid-line'"
      :title="
        library.loading ? '正在读取资料' : assets.query ? '没有匹配资产' : `还没有${currentView?.label ?? ''}资产`
      "
      :description="
        library.loading
          ? undefined
          : assets.query
            ? '换个关键词，或清除筛选。'
            : '从模板新建，或在目录树里把文件识别为资产。'
      "
    >
      <AppButton
        v-if="!library.loading && !assets.query"
        size="xs"
        @click="templates.openCreate(currentView?.template)"
      >
        新建{{ currentView?.label ?? '资产' }}
      </AppButton>
    </AppEmptyState>
    <AppPanelSection
      v-for="group in groups"
      :key="group.label"
      class="structure-group"
      :title="group.label"
      :count="group.assets.length"
    >
      <ul class="structure-list">
        <li v-for="asset in group.assets" :key="asset.sourcePath">
          <AppListItem
            dense
            class="structure-row"
            :title="asset.title"
            :meta="rowMeta(asset)"
            :selected="editor.activeTab?.path === asset.sourcePath"
            :aria-label="`打开资产 ${asset.title} ${asset.sourcePath}`"
            @click="assets.open(asset.sourcePath)"
          >
            <template #leading><span class="i-mingcute-document-line size-4" aria-hidden="true" /></template>
            <template
              v-if="asset.links.some(link => link.status === 'missing' || link.status === 'ambiguous')"
              #trailing
            >
              <span class="i-mingcute-warning-line structure-warning size-3.5" aria-label="含未解决引用" />
            </template>
          </AppListItem>
        </li>
      </ul>
    </AppPanelSection>
    <AppPanelSection
      v-if="conflicts.length"
      class="structure-group structure-conflicts"
      title="冲突待处理"
      :count="conflicts.length"
    >
      <AppListItem
        v-for="item in conflicts"
        :key="item.sourcePath"
        dense
        :title="item.sourcePath ?? item.message"
        @click="item.sourcePath && editor.openDocument(item.sourcePath)"
      >
        <template #leading
          ><span class="i-mingcute-warning-line size-4 structure-warning" aria-hidden="true"
        /></template>
      </AppListItem>
    </AppPanelSection>
    <AppPanelSection
      v-if="diagnostics.length"
      class="structure-group"
      title="索引诊断"
      :count="diagnostics.length"
      :open="false"
    >
      <AppNotice v-for="(item, index) in diagnostics" :key="index" tone="error">
        {{ item.sourcePath }} {{ item.message }}
      </AppNotice>
    </AppPanelSection>
  </AppPanel>
</template>
<style scoped lang="scss">
.library-views {
  @apply flex items-center gap-0.5;
}
.library-actions-divider {
  @apply mx-1 h-4 w-px shrink-0;
  background: var(--border);
}
// 七个类型排成整齐的 4 + 3 网格：每格等宽、居中，不会出现参差的换行。
.structure-tab-list {
  @apply grid gap-x-1 gap-y-0.5;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.structure-tab {
  @apply h-6 min-w-0 truncate border-0 px-1 outline-none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  transition:
    color var(--motion-duration) ease-out,
    background-color var(--motion-duration) ease-out;
}
.structure-tab:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}
.structure-tab[data-state='active'] {
  background: var(--secondary);
  color: var(--secondary-foreground);
  font-weight: 600;
}
.structure-tab:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
.structure-filter {
  @apply flex min-w-0 items-center gap-1;
}
.structure-filter-input {
  @apply min-w-0 flex-1;
}
.structure-options {
  @apply flex shrink-0 items-center;
}
.structure-list {
  @apply m-0 list-none p-0;
}
.structure-row {
  @apply pl-5;
}
.structure-warning {
  color: var(--warning);
}
</style>
