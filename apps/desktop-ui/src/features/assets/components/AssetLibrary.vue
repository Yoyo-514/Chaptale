<script setup lang="ts">
import { computed, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useTemplateStore } from '@/features/templates';

import { assetKindLabel } from '../presentation';
import { isPublicAsset, matchesAsset } from '../story-model';
import AssetContextMenu from './AssetContextMenu.vue';

const library = useLibraryStore();
const editor = useEditorStore();
const templates = useTemplateStore();
const query = ref('');
const kind = ref('__all');
const archived = ref(false);
const mode = ref<'cards' | 'list'>('cards');
const kinds = computed(() =>
  [...new Set(library.assets.filter(isPublicAsset).map(asset => asset.kind ?? '__none'))].toSorted()
);
const assets = computed(() =>
  library.assets
    .filter(
      asset =>
        isPublicAsset(asset) &&
        (archived.value || asset.status !== 'archived') &&
        (kind.value === '__all' || (asset.kind ?? '__none') === kind.value) &&
        matchesAsset(asset, query.value)
    )
    .toSorted((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }))
);
function assetIcon(assetKind?: string) {
  if (assetKind === 'character') return 'i-mingcute-user-3-line';
  if (assetKind === 'timeline-event') return 'i-mingcute-time-line';
  if (assetKind === 'world') return 'i-mingcute-globe-line';
  if (assetKind === 'plot-thread') return 'i-mingcute-link-line';
  if (assetKind === 'outline' || assetKind === 'scene-card') return 'i-mingcute-list-check-line';
  return 'i-mingcute-document-line';
}
</script>
<template>
  <section class="asset-library" aria-label="作品资料库">
    <header class="asset-library-heading">
      <h2>
        资料库 <span>{{ assets.length }}</span>
      </h2>
      <AppButton variant="primary" @click="templates.openCreate('character-main')"
        ><span class="i-mingcute-add-line" aria-hidden="true" />新建资产</AppButton
      >
      <AppTooltip text="刷新资料库"
        ><AppButton icon variant="ghost" aria-label="刷新资料库" :disabled="library.loading" @click="library.load"
          ><span class="i-mingcute-refresh-3-line" aria-hidden="true" /></AppButton
      ></AppTooltip>
    </header>
    <div class="asset-library-filters">
      <AppInput v-model="query" aria-label="搜索资料库" placeholder="搜索资料库"
        ><template #prefix><span class="i-mingcute-search-line" aria-hidden="true" /></template
      ></AppInput>
      <AppSelect v-model="kind" aria-label="资料类型">
        <AppSelectItem value="__all">全部类型</AppSelectItem>
        <AppSelectItem v-for="item in kinds" :key="item" :value="item">{{
          assetKindLabel(item === '__none' ? undefined : item)
        }}</AppSelectItem>
      </AppSelect>
      <label><AppCheckbox v-model="archived" />包含归档</label>
      <div class="asset-library-modes" role="group" aria-label="资料排列">
        <AppTooltip text="卡片"
          ><AppButton
            icon
            variant="ghost"
            aria-label="资料卡片视图"
            :selected="mode === 'cards'"
            :aria-pressed="mode === 'cards'"
            @click="mode = 'cards'"
            ><span class="i-mingcute-grid-line" aria-hidden="true" /></AppButton
        ></AppTooltip>
        <AppTooltip text="列表"
          ><AppButton
            icon
            variant="ghost"
            aria-label="资料列表视图"
            :selected="mode === 'list'"
            :aria-pressed="mode === 'list'"
            @click="mode = 'list'"
            ><span class="i-mingcute-list-check-line" aria-hidden="true" /></AppButton
        ></AppTooltip>
      </div>
    </div>
    <p v-if="library.error" class="asset-library-error" role="alert">{{ library.error }}</p>
    <AppScrollArea class="asset-library-scroll">
      <p v-if="!assets.length" class="asset-library-empty" role="status">
        {{ library.loading ? '正在读取资料' : '没有匹配的资产' }}
      </p>
      <div class="asset-library-results" :class="mode">
        <AssetContextMenu v-for="asset in assets" :key="asset.sourcePath" :asset="asset">
          <AppButton
            variant="ghost"
            class="asset-card"
            :data-asset-path="asset.sourcePath"
            :aria-label="`打开资料 ${asset.title} ${asset.sourcePath}`"
            @click="editor.openDocument(asset.sourcePath)"
          >
            <span class="asset-card-type"
              ><span :class="assetIcon(asset.kind)" aria-hidden="true" />{{ assetKindLabel(asset.kind) }}</span
            >
            <strong>{{ asset.title }}</strong>
            <span class="asset-card-excerpt">{{ asset.excerpt || '暂无正文' }}</span>
            <span class="asset-card-path" :title="asset.sourcePath">{{ asset.sourcePath }}</span>
            <span v-if="asset.links.some(link => !link.targetPath)" class="asset-card-warning"
              ><span class="i-mingcute-warning-line" aria-hidden="true" />引用待确认</span
            >
          </AppButton>
        </AssetContextMenu>
      </div>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.asset-library {
  @apply flex min-h-0 min-w-0 flex-1 flex-col;
  font-size: var(--ui-font-size);
}
.asset-library-heading {
  @apply flex min-h-14 shrink-0 flex-wrap items-center gap-2 px-5 py-3;
}
.asset-library-heading h2 {
  @apply m-0 min-w-0 flex-1 text-base font-semibold;
}
.asset-library-heading h2 span {
  @apply ml-2 text-sm font-normal;
  color: var(--muted-foreground);
}
.asset-library-filters {
  @apply flex shrink-0 flex-wrap items-center gap-3 border-b px-5 pb-3;
  border-color: var(--border-subtle);
}
.asset-library-filters > :first-child {
  @apply min-w-36 flex-1;
}
.asset-library-filters :deep(.app-select-trigger) {
  max-width: 160px;
}
.asset-library-filters label {
  @apply flex shrink-0 items-center gap-2;
  color: var(--muted-foreground);
}
.asset-library-modes {
  @apply ml-auto flex gap-1;
}
.asset-library-scroll {
  @apply min-h-0 flex-1;
}
.asset-library-results {
  @apply grid gap-3 p-5;
}
.asset-library-results.cards {
  grid-template-columns: repeat(auto-fill, minmax(min(210px, 100%), 1fr));
}
.asset-card {
  @apply relative grid min-w-0 content-start items-start justify-items-start gap-2 border p-4 text-left;
  grid-template-columns: minmax(0, 1fr);
  justify-content: stretch;
  border-color: var(--border-subtle);
  background: var(--surface-elevated);
  border-radius: 6px;
  white-space: normal;
  min-height: 184px;
}
.asset-card > * {
  min-width: 0;
  max-width: 100%;
}
.asset-card strong {
  @apply text-sm font-semibold;
  overflow-wrap: anywhere;
}
.asset-card-type {
  @apply flex items-center gap-2;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.asset-card-type > span {
  @apply size-4;
  color: var(--primary-solid);
}
.asset-card-excerpt {
  @apply line-clamp-3;
  line-height: 1.65;
  font-weight: 400;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
.asset-card-path {
  @apply block min-w-0 truncate pt-1;
  font-size: var(--ui-caption-size);
  font-weight: 400;
  color: var(--muted-foreground);
}
.asset-card-warning {
  @apply flex items-center gap-1;
  color: var(--warning);
  font-size: var(--ui-caption-size);
}
.asset-library-results.list {
  @apply gap-0;
}
.list .asset-card {
  @apply grid-cols-[minmax(80px,0.5fr)_minmax(120px,1fr)_minmax(0,2fr)] items-center gap-x-4 border-0 border-b px-2 py-3;
  min-height: 72px;
  border-radius: 0;
  background: transparent;
}
.list .asset-card-excerpt {
  @apply line-clamp-2;
}
.list .asset-card-path {
  grid-column: 2 / -1;
}
.asset-library-empty,
.asset-library-error {
  @apply m-0 p-5;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
.asset-library-error {
  color: var(--destructive);
}
@container (max-width: 560px) {
  .list .asset-card {
    @apply grid-cols-2;
  }
  .list .asset-card-excerpt,
  .list .asset-card-path {
    grid-column: 1 / -1;
  }
}
</style>
