<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import type { EditorGroupIndex } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { useCreationStore } from '@/features/creation';
import { toErrorMessage } from '@/utils/desktop-api';
import { captureEditingTarget } from '@/utils/editing-target';

import { useIllustrationImages } from '../illustrations/images';
import { useEditorStore } from '../store';
import type { EditorTab } from '../types';
import { chapterOrder, readingBlocks, type ReadingBlock } from './blocks';
import { countPages, offsetOf, pageOf, type PageGeometry } from './layout';
import { useReadingStore } from './store';

const props = withDefaults(defineProps<{ tab: EditorTab; groupIndex?: EditorGroupIndex }>(), {
  groupIndex: 0
});
const reading = useReadingStore();
const editor = useEditorStore();
const creation = useCreationStore();
const slot = computed(() => reading.slotKey(props.groupIndex, props.tab.id));
/** 栏间距；一栏即一页，翻页步长为栏宽加栏间距。 */
const GAP = 48;
const viewport = ref<HTMLElement>();
const columns = ref<HTMLElement>();
const size = ref({ width: 0, height: 0 });
const chapter = shallowRef<{ id: string; title: string; format: EditorTab['format']; blocks: ReadingBlock[] }>();
const page = ref(0);
const pages = ref(1);
const error = ref('');
let loadVersion = 0;
let observer: ResizeObserver | undefined;
let editingTarget: ReturnType<typeof captureEditingTarget> | undefined;
const quoteText = ref<string>();
const menu = computed<AppContextMenuItem[]>(() => [
  { id: 'copy', label: '复制', shortcut: 'Ctrl+C', disabled: !quoteText.value },
  { id: 'quoteToChat', label: '引用到对话', disabled: !quoteText.value, separatorBefore: true }
]);

function prepareMenu() {
  editor.focusGroup(props.groupIndex);
  quoteText.value = reading.selectedText(slot.value) || undefined;
  editingTarget = captureEditingTarget();
}
async function selectAction(id: string) {
  await nextTick();
  if (id === 'quoteToChat') {
    if (!quoteText.value || !chapter.value) return;
    const entry = creation.entries.find(item => item.id === chapter.value!.id);
    editor.quoteToChat({
      workId: props.tab.workId,
      entryId: chapter.value.id,
      title: chapter.value.title,
      section: entry?.section ?? props.tab.document?.section ?? 'manuscript',
      selection: quoteText.value
    });
    return;
  }
  if (id === 'copy') await editingTarget?.execute('copy');
}

const illustrations = useIllustrationImages(() => props.tab.workId);
/** 插图图片的显示状态：src 为已读取的图片，否则为占位文字。 */
function illustrationState(entryId: string) {
  const image = illustrations.images.value[entryId];
  if (!image) return { text: '正在读取图片…' };
  return 'src' in image ? { src: image.src } : { text: image.error };
}
const position = computed(() => reading.positions[slot.value]!);
const chapters = computed(() => chapterOrder(creation.entries));
const index = computed(() => chapters.value.findIndex(entry => entry.id === chapter.value?.id));
const stride = computed(() => size.value.width + GAP);

function geometry(): PageGeometry {
  return { columns: columns.value!, stride: stride.value, charLevel: chapter.value!.format !== 'markdown' };
}
function show(target: number) {
  page.value = target;
  reading.remember(slot.value, { documentId: chapter.value!.id, offset: offsetOf(geometry(), target) });
}

/** 读取章节并按 offset 或末页定位；迟到的读取结果丢弃。 */
async function load(documentId: string, target: number | 'end') {
  const version = ++loadVersion;
  error.value = '';
  try {
    const content = await reading.readChapter(documentId);
    if (version !== loadVersion) return;
    reading.remember(slot.value, { documentId, offset: target === 'end' ? position.value.offset : target });
    const blocks = readingBlocks(content.content, content.format);
    for (const block of blocks) if (block.illustration) void illustrations.load(block.illustration.entryId);
    chapter.value = { ...content, blocks };
    await layout(target);
  } catch (cause) {
    if (version === loadVersion) error.value = toErrorMessage(cause);
  }
}

/** 重新测量页数，并把 offset（或末页）换算为页码。 */
async function layout(target: number | 'end' = position.value.offset) {
  await nextTick();
  if (!columns.value || !size.value.width) return;
  pages.value = countPages(geometry(), GAP);
  show(target === 'end' ? pages.value - 1 : pageOf(geometry(), target, pages.value));
}

function next() {
  if (page.value < pages.value - 1) show(page.value + 1);
  else if (index.value >= 0 && index.value < chapters.value.length - 1)
    void load(chapters.value[index.value + 1]!.id, 0);
}
function previous() {
  if (page.value > 0) show(page.value - 1);
  else if (index.value > 0) void load(chapters.value[index.value - 1]!.id, 'end');
}
function keydown(event: KeyboardEvent) {
  const forward = ['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
  const backward = ['ArrowLeft', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
  if (!forward && !backward) return;
  event.preventDefault();
  if (forward) next();
  else previous();
}

onMounted(() => {
  reading.bindViewport(slot.value, viewport.value!);
  observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry!.contentRect;
    if (width === size.value.width && height === size.value.height) return;
    size.value = { width: Math.floor(width), height: Math.floor(height) };
    if (chapter.value) void layout();
  });
  observer.observe(viewport.value!);
  void load(position.value.documentId, position.value.offset);
  viewport.value!.focus();
});
onBeforeUnmount(() => {
  reading.bindViewport(slot.value, null);
  observer?.disconnect();
});
watch(
  () => props.tab.format,
  () => {
    if (chapter.value?.id === props.tab.id && position.value) void load(props.tab.id, position.value.offset);
  }
);
watch(
  () => editor.bufferVersions,
  (versions, previous) => {
    const currentId = chapter.value?.id;
    if (currentId && versions[currentId] !== previous[currentId] && position.value) {
      void load(currentId, position.value.offset);
    }
  }
);
</script>

<template>
  <section class="reading-view" :aria-label="`阅读：${chapter?.title ?? tab.title}`">
    <header class="reading-header">
      <h2 class="reading-title">{{ chapter?.title ?? tab.title }}</h2>
      <AppButton size="xs" :disabled="!chapter" @click="reading.edit(tab.id, groupIndex)">编辑</AppButton>
    </header>
    <p v-if="error" class="reading-error" role="alert">{{ error }}</p>
    <AppContextMenu :items="menu" @prepare="prepareMenu" @select="selectAction">
      <div class="reading-context-host">
        <div ref="viewport" class="reading-viewport" tabindex="0" aria-label="阅读页" @keydown="keydown">
          <div
            v-if="chapter"
            ref="columns"
            class="reading-columns"
            :class="{ 'markdown-body': chapter.format === 'markdown' }"
            :style="{
              width: `${size.width}px`,
              height: `${size.height}px`,
              columnWidth: `${size.width}px`,
              columnGap: `${GAP}px`,
              transform: `translateX(-${page * stride}px)`,
              '--page-height': `${size.height}px`
            }"
            @load.capture="layout()"
          >
            <template v-for="block in chapter.blocks" :key="block.offset">
              <figure
                v-if="block.illustration"
                class="reading-block reading-illustration"
                :data-offset="block.offset"
                :aria-label="`插图 ${block.illustration.caption}`"
              >
                <span v-if="illustrationState(block.illustration.entryId).src" class="reading-illustration-frame">
                  <img :src="illustrationState(block.illustration.entryId).src" :alt="block.illustration.caption" />
                  <span v-if="block.illustration.caption" class="reading-illustration-caption">{{
                    block.illustration.caption
                  }}</span>
                </span>
                <span v-else class="reading-illustration-missing"
                  >{{ illustrationState(block.illustration.entryId).text
                  }}{{ block.illustration.caption ? `：${block.illustration.caption}` : '' }}</span
                >
              </figure>
              <div v-else class="reading-block" :data-offset="block.offset" v-html="block.html" />
            </template>
          </div>
        </div>
      </div>
    </AppContextMenu>
    <footer class="reading-footer">
      <AppButton size="xs" variant="ghost" :disabled="page === 0 && index <= 0" @click="previous">上一页</AppButton>
      <span role="status">本章 {{ page + 1 }} / {{ pages }}</span>
      <AppButton size="xs" variant="ghost" :disabled="page >= pages - 1 && index >= chapters.length - 1" @click="next"
        >下一页</AppButton
      >
    </footer>
  </section>
</template>

<style scoped>
.reading-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--mica-background);
}
.reading-header,
.reading-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  font-size: var(--ui-font-size);
  color: var(--muted-foreground);
}
.reading-header {
  border-bottom: 1px solid var(--border-subtle);
}
.reading-footer {
  border-top: 1px solid var(--border-subtle);
}
.reading-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--ui-font-size);
  font-weight: 500;
  color: var(--foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reading-error {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  color: var(--destructive);
}
.reading-context-host {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.reading-viewport {
  flex: 1;
  min-height: 0;
  margin: 24px 32px;
  overflow: hidden;
  outline: none;
}
.reading-columns {
  font-size: 16px;
  line-height: 1.9;
  color: var(--foreground);
  overflow-wrap: anywhere;
}
.reading-block {
  min-height: 1lh;
  white-space: pre-wrap;
}
.markdown-body .reading-block {
  white-space: normal;
}
/* 插图按页宽缩放，整体不跨页；高于一页时缩到一页高，单独占一页。说明悬停时叠在图片底部。 */
.reading-illustration {
  margin: 8px 0;
  text-align: center;
  break-inside: avoid;
}
.reading-illustration-frame {
  position: relative;
  display: inline-block;
  max-width: 100%;
  vertical-align: top;
}
.reading-illustration img {
  display: block;
  max-width: 100%;
  max-height: calc(var(--page-height) - 16px);
  object-fit: contain;
}
.reading-illustration-caption {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 2px 8px;
  overflow: hidden;
  font-size: 12px;
  line-height: 20px;
  color: #fff;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: rgb(0 0 0 / 55%);
  opacity: 0;
  pointer-events: none;
}
.reading-illustration-frame:hover .reading-illustration-caption {
  opacity: 1;
}
.reading-illustration-missing {
  display: block;
  padding: 12px;
  font-size: 12px;
  color: var(--muted-foreground);
  border: 1px dashed var(--border);
  border-radius: 4px;
}
.reading-block :deep(img) {
  max-width: 100%;
  max-height: 100%;
  break-inside: avoid;
}
</style>
