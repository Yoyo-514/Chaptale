<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { useCreationStore } from '@/features/creation';
import { toErrorMessage } from '@/utils/desktop-api';

import { chapterOrder, readingBlocks, type ReadingBlock } from '../reading';
import { useEditorStore } from '../store';
import type { EditorTab } from '../types';

const props = defineProps<{ tab: EditorTab }>();
const editor = useEditorStore();
const creation = useCreationStore();
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

const position = computed(() => editor.reading[props.tab.id]!);
const chapters = computed(() => chapterOrder(creation.entries));
const index = computed(() => chapters.value.findIndex(entry => entry.id === chapter.value?.id));
const stride = computed(() => size.value.width + GAP);

function remember(documentId: string, offset: number) {
  editor.reading = { ...editor.reading, [props.tab.id]: { documentId, offset } };
}

/** 读取章节并按 offset 或末页定位；迟到的读取结果丢弃。 */
async function load(documentId: string, target: number | 'end') {
  const version = ++loadVersion;
  error.value = '';
  try {
    const content = await editor.readChapter(documentId);
    if (version !== loadVersion) return;
    chapter.value = { id: documentId, ...content, blocks: readingBlocks(content.content, content.format) };
    await layout(target);
  } catch (cause) {
    if (version === loadVersion) error.value = toErrorMessage(cause);
  }
}

/** 重新测量页数，并把 offset（或末页）换算为页码。 */
async function layout(target: number | 'end' = position.value.offset) {
  await nextTick();
  const element = columns.value;
  if (!element || !size.value.width) return;
  pages.value = Math.max(1, Math.round((element.scrollWidth + GAP) / stride.value));
  page.value = target === 'end' ? pages.value - 1 : pageOf(target);
  remember(chapter.value!.id, offsetOf(page.value));
}

function blockElements() {
  return [...columns.value!.querySelectorAll<HTMLElement>('[data-offset]')];
}
function columnOf(rect: DOMRect) {
  return Math.floor((rect.left - columns.value!.getBoundingClientRect().left + 1) / stride.value);
}
/** TXT 块内按字符定位，Markdown 停在块开头。 */
function pageOf(offset: number) {
  const blocks = blockElements();
  const block = blocks.findLast(item => Number(item.dataset.offset) <= offset) ?? blocks[0];
  if (!block) return 0;
  const text = block.firstChild;
  const local = offset - Number(block.dataset.offset);
  if (chapter.value!.format !== 'markdown' && text instanceof Text && local > 0 && local < text.length) {
    const range = document.createRange();
    range.setStart(text, local);
    range.setEnd(text, local + 1);
    const rect = range.getClientRects()[0];
    if (rect) return Math.min(columnOf(rect), pages.value - 1);
  }
  const rect = block.getClientRects()[0];
  return rect ? Math.min(columnOf(rect), pages.value - 1) : 0;
}
function offsetOf(target: number) {
  for (const block of blockElements()) {
    const rects = [...block.getClientRects()];
    if (!rects.some(rect => columnOf(rect) >= target)) continue;
    const start = Number(block.dataset.offset);
    const text = block.firstChild;
    if (chapter.value!.format === 'markdown' || columnOf(rects[0]!) >= target || !(text instanceof Text)) return start;
    // 段落从上一页延续过来时，二分找到本页第一个字符。
    const range = document.createRange();
    let low = 0;
    let high = text.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      range.setStart(text, middle);
      range.setEnd(text, middle + 1);
      const rect = range.getClientRects()[0];
      if (rect && columnOf(rect) >= target) high = middle;
      else low = middle + 1;
    }
    return start + low;
  }
  return chapter.value?.blocks.at(-1)?.offset ?? 0;
}

function next() {
  if (page.value < pages.value - 1) {
    page.value++;
    remember(chapter.value!.id, offsetOf(page.value));
  } else if (index.value >= 0 && index.value < chapters.value.length - 1)
    void load(chapters.value[index.value + 1]!.id, 0);
}
function previous() {
  if (page.value > 0) {
    page.value--;
    remember(chapter.value!.id, offsetOf(page.value));
  } else if (index.value > 0) void load(chapters.value[index.value - 1]!.id, 'end');
}
function keydown(event: KeyboardEvent) {
  const forward = ['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
  const backward = ['ArrowLeft', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
  if (!forward && !backward) return;
  event.preventDefault();
  if (forward) next();
  else previous();
}
function edit() {
  void editor.editAt(props.tab.id, chapter.value!.id, position.value.offset);
}

onMounted(() => {
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
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => props.tab.format,
  () => {
    if (chapter.value?.id === props.tab.id) void load(props.tab.id, position.value.offset);
  }
);
</script>

<template>
  <section class="reading-view" :aria-label="`阅读：${chapter?.title ?? tab.title}`">
    <header class="reading-header">
      <h2 class="reading-title">{{ chapter?.title ?? tab.title }}</h2>
      <AppButton size="xs" :disabled="!chapter" @click="edit">编辑</AppButton>
    </header>
    <p v-if="error" class="reading-error" role="alert">{{ error }}</p>
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
          transform: `translateX(-${page * stride}px)`
        }"
        @load.capture="layout()"
      >
        <div
          v-for="block in chapter.blocks"
          :key="block.offset"
          class="reading-block"
          :data-offset="block.offset"
          v-html="block.html"
        />
      </div>
    </div>
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
.reading-block :deep(img) {
  max-width: 100%;
  max-height: 100%;
  break-inside: avoid;
}
</style>
