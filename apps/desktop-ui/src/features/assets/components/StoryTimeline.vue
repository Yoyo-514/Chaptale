<script setup lang="ts">
import { computed, ref } from 'vue';

import { resolveAssetLink } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useTemplateStore } from '@/features/templates';

import { eventOrder, fieldLinks, fieldText, storyEvents } from '../story-model';
import { useStoryStore } from '../story-store';
import AssetContextMenu from './AssetContextMenu.vue';

const library = useLibraryStore();
const editor = useEditorStore();
const templates = useTemplateStore();
const story = useStoryStore();
const query = ref('');
const strand = ref('__all');
const archived = ref(false);
const events = computed(() =>
  storyEvents(library.assets, query.value, strand.value === '__all' ? '' : strand.value, archived.value)
);
const strands = computed(() =>
  [
    ...new Set(
      storyEvents(library.assets, '', '', archived.value)
        .map(asset => fieldText(asset.frontmatter.strand))
        .filter(Boolean)
    )
  ].toSorted()
);
function create() {
  const orders = storyEvents(library.assets).map(eventOrder).filter(Number.isFinite);
  const next = orders.length ? Math.max(...orders) + 1 : 1;
  void templates.openCreate('story-event', {
    order: next,
    ...(strand.value !== '__all' ? { strand: strand.value } : {})
  });
}
function linkInfo(raw: string) {
  const link = resolveAssetLink(raw, library.assets);
  const asset = library.assets.find(value => value.sourcePath === link.targetPath);
  return { ...link, label: asset?.title ?? raw.replace(/^\[\[|\]\]$/g, '') };
}
</script>
<template>
  <section class="story-timeline" aria-label="作品故事时间线">
    <header class="timeline-heading">
      <h2>
        故事时间线 <span>{{ events.length }} 个事件</span>
      </h2>
      <AppButton variant="primary" @click="create"
        ><span class="i-mingcute-add-line" aria-hidden="true" />新建事件</AppButton
      >
      <AppTooltip text="刷新时间线"
        ><AppButton icon variant="ghost" aria-label="刷新时间线" :disabled="library.loading" @click="library.load"
          ><span class="i-mingcute-refresh-3-line" aria-hidden="true" /></AppButton
      ></AppTooltip>
    </header>
    <div class="timeline-filters">
      <AppInput v-model="query" aria-label="筛选故事事件" placeholder="筛选故事事件"
        ><template #prefix><span class="i-mingcute-search-line" aria-hidden="true" /></template
      ></AppInput>
      <AppSelect v-model="strand" aria-label="筛选故事线"
        ><AppSelectItem value="__all">全部故事线</AppSelectItem
        ><AppSelectItem v-for="item in strands" :key="item" :value="item">{{ item }}</AppSelectItem></AppSelect
      >
      <label><AppCheckbox v-model="archived" />包含归档</label>
    </div>
    <p v-if="library.error" class="timeline-error" role="alert">{{ library.error }}</p>
    <AppScrollArea class="timeline-scroll">
      <p v-if="!events.length" class="timeline-empty" role="status">
        {{ library.loading ? '正在读取故事事件' : '没有匹配的故事事件' }}
      </p>
      <ol class="timeline-events">
        <template v-for="(asset, index) in events" :key="asset.sourcePath">
          <li
            v-if="
              !Number.isFinite(eventOrder(asset)) && (index === 0 || Number.isFinite(eventOrder(events[index - 1]!)))
            "
            class="timeline-unsorted"
          >
            未排序事件
          </li>
          <AssetContextMenu :asset="asset">
            <li class="timeline-event" :data-event-path="asset.sourcePath">
              <div class="timeline-time">
                <span class="timeline-sequence">{{ Number.isFinite(eventOrder(asset)) ? eventOrder(asset) : '?' }}</span
                ><span>{{ fieldText(asset.frontmatter.when) || '时间未定' }}</span>
              </div>
              <div class="timeline-event-body">
                <div class="timeline-event-title">
                  <AppButton variant="link" class="timeline-title" @click="editor.openDocument(asset.sourcePath)">{{
                    asset.title
                  }}</AppButton>
                  <AppTooltip text="编辑事件"
                    ><AppButton icon variant="ghost" aria-label="编辑事件" @click="story.editEvent(asset)"
                      ><span class="i-mingcute-edit-line" aria-hidden="true" /></AppButton
                  ></AppTooltip>
                </div>
                <span v-if="fieldText(asset.frontmatter.strand)" class="timeline-strand">{{
                  fieldText(asset.frontmatter.strand)
                }}</span>
                <p v-if="fieldText(asset.frontmatter.summary)">{{ fieldText(asset.frontmatter.summary) }}</p>
                <div class="timeline-links">
                  <template
                    v-for="raw in [
                      ...new Set(
                        [
                          ...fieldLinks(asset.frontmatter.cast),
                          fieldText(asset.frontmatter.chapter),
                          fieldText(asset.frontmatter.location)
                        ].filter(Boolean)
                      )
                    ]"
                    :key="raw"
                  >
                    <AppButton
                      size="xs"
                      variant="link"
                      :disabled="!linkInfo(raw).targetPath"
                      :title="raw"
                      @click="editor.openDocument(linkInfo(raw).targetPath!)"
                      ><span class="i-mingcute-link-line" aria-hidden="true" />{{ linkInfo(raw).label }}</AppButton
                    >
                  </template>
                </div>
                <small>{{ asset.sourcePath }}</small>
              </div>
            </li>
          </AssetContextMenu>
        </template>
      </ol>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.story-timeline {
  @apply flex min-h-0 min-w-0 flex-1 flex-col;
  font-size: var(--ui-font-size);
}
.timeline-heading {
  @apply flex min-h-14 shrink-0 flex-wrap items-center gap-2 px-5 py-3;
}
.timeline-heading h2 {
  @apply m-0 min-w-0 flex-1 text-base font-semibold;
}
.timeline-heading h2 span {
  @apply ml-2 text-xs font-normal;
  color: var(--muted-foreground);
}
.timeline-filters {
  @apply flex shrink-0 flex-wrap items-center gap-3 border-b px-5 pb-3;
  border-color: var(--border-subtle);
}
.timeline-filters > :first-child {
  @apply min-w-36 flex-1;
}
.timeline-filters :deep(.app-select-trigger) {
  max-width: 180px;
}
.timeline-filters label {
  @apply flex items-center gap-2;
  color: var(--muted-foreground);
}
.timeline-scroll {
  @apply min-h-0 flex-1;
}
.timeline-events {
  @apply m-0 list-none px-5 py-4;
}
.timeline-event {
  @apply grid min-w-0 grid-cols-[minmax(80px,120px)_minmax(0,1fr)];
}
.timeline-time {
  @apply flex min-w-0 flex-col items-end gap-2 pr-5 pt-3 text-right;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
.timeline-sequence {
  @apply flex size-7 shrink-0 items-center justify-center border font-medium;
  border-radius: 50%;
  border-color: var(--border-subtle);
  color: var(--primary-solid);
}
.timeline-event-body {
  @apply relative min-w-0 border-l-2 pb-6 pl-5 pt-1;
  border-color: var(--border-subtle);
}
.timeline-event-body::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 23px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary-solid);
}
.timeline-event-title {
  @apply flex min-w-0 items-start justify-between gap-1;
}
.timeline-title {
  @apply min-w-0 justify-start px-0 text-left text-sm font-semibold;
  white-space: normal;
  overflow-wrap: anywhere;
  color: var(--foreground);
}
.timeline-strand {
  @apply inline-block pb-1;
  color: var(--primary-solid);
  font-size: var(--ui-caption-size);
}
.timeline-event-body p {
  @apply mb-2 mt-1 whitespace-pre-wrap;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.timeline-links {
  @apply flex flex-wrap gap-2;
}
.timeline-links button {
  @apply h-auto min-h-6 min-w-0 px-0;
  white-space: normal;
  overflow-wrap: anywhere;
}
.timeline-event-body small {
  @apply block pt-2;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  overflow-wrap: anywhere;
}
.timeline-unsorted {
  @apply mb-3 border-t py-3 font-medium;
  border-color: var(--border-subtle);
  color: var(--warning);
}
.timeline-empty,
.timeline-error {
  @apply m-0 p-5;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
.timeline-error {
  color: var(--destructive);
}
@container (max-width: 460px) {
  .timeline-event {
    grid-template-columns: 72px minmax(0, 1fr);
  }
  .timeline-time {
    @apply pr-3;
  }
  .timeline-event-body {
    @apply pl-3;
  }
}
</style>
