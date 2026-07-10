<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  VisuallyHidden
} from 'reka-ui';
import { computed, ref, watch } from 'vue';

import AppImageLightboxFilmstrip from './AppImageLightboxFilmstrip.vue';
import type { AppImagePreviewItem } from './types';
import { useImageZoom } from './useImageZoom';
import { useOriginalImage } from './useOriginalImage';

const props = defineProps<{
  items: AppImagePreviewItem[];
}>();

const activeIndex = defineModel<number | null>('activeIndex', { required: true });

const isOpen = computed(
  () => activeIndex.value !== null && activeIndex.value >= 0 && activeIndex.value < props.items.length
);
const currentItem = computed(() => (isOpen.value ? props.items[activeIndex.value!] : undefined));
const { originalSrc, isLoading, errorMessage } = useOriginalImage(currentItem);

const viewportRef = ref<HTMLElement | null>(null);
const imageRef = ref<HTMLImageElement | null>(null);
const {
  scale: zoomScale,
  isZoomed,
  isPanning,
  imageStyle,
  zoomIn,
  zoomOut,
  reset: resetZoom,
  onWheel: onZoomWheel,
  onDoubleClick: onZoomDoubleClick,
  onPointerDown: onZoomPointerDown,
  onPointerMove: onZoomPointerMove,
  onPointerUp: onZoomPointerUp,
  onKeydown: onZoomKeydown
} = useImageZoom({ viewportRef, imageRef, resetKey: activeIndex });
const zoomPercentage = computed(() => `${Math.round(zoomScale.value * 100)}%`);

function close() {
  activeIndex.value = null;
}

function markOriginalRenderFailed() {
  errorMessage.value = '原图解码失败';
}

function move(step: number) {
  if (!isOpen.value || props.items.length <= 1) {
    return;
  }

  activeIndex.value = (activeIndex.value! + step + props.items.length) % props.items.length;
}

// 打开状态下图片列表缩短导致索引越界时，直接关闭而不是停留在无效状态。
watch(
  () => props.items.length,
  length => {
    if (activeIndex.value !== null && activeIndex.value >= length) {
      close();
    }
  }
);
</script>

<template>
  <DialogRoot :open="isOpen" @update:open="open => !open && close()">
    <DialogPortal>
      <DialogOverlay class="app-image-lightbox-overlay" data-slot="app-image-lightbox-overlay" />
      <DialogContent
        class="app-image-lightbox"
        data-slot="app-image-lightbox"
        @click.self="close"
        @keydown.left.prevent="move(-1)"
        @keydown.right.prevent="move(1)"
        @keydown="onZoomKeydown"
      >
        <VisuallyHidden>
          <DialogTitle>{{ currentItem?.alt || '图片预览' }}</DialogTitle>
          <DialogDescription>使用左右方向键、箭头按钮或底部缩略图切换图片</DialogDescription>
        </VisuallyHidden>

        <div class="app-image-lightbox-counter" aria-live="polite">
          {{ (activeIndex ?? 0) + 1 }} / {{ props.items.length }}
        </div>

        <button
          class="app-image-lightbox-button app-image-lightbox-close"
          type="button"
          aria-label="关闭预览"
          @click="close"
        >
          <span class="i-mingcute-close-line size-5" aria-hidden="true" />
        </button>

        <div class="app-image-lightbox-stage" @click.self="close">
          <button
            v-if="props.items.length > 1"
            class="app-image-lightbox-button app-image-lightbox-nav"
            type="button"
            aria-label="上一张图片"
            @click="move(-1)"
          >
            <span class="i-mingcute-left-line size-5" aria-hidden="true" />
          </button>

          <div ref="viewportRef" class="app-image-lightbox-viewport" @click.self="close" @wheel.prevent="onZoomWheel">
            <span v-if="isLoading" class="app-image-lightbox-hint">正在加载原图...</span>
            <span v-else-if="errorMessage" class="app-image-lightbox-hint app-image-lightbox-error">
              {{ errorMessage }}
            </span>
            <img
              v-else-if="originalSrc"
              ref="imageRef"
              :class="[
                'app-image-lightbox-image',
                isZoomed && 'app-image-lightbox-image-pannable',
                isPanning && 'app-image-lightbox-image-panning'
              ]"
              :src="originalSrc"
              :alt="currentItem?.alt"
              :style="imageStyle"
              decoding="async"
              draggable="false"
              @error="markOriginalRenderFailed"
              @dblclick="onZoomDoubleClick"
              @pointerdown="onZoomPointerDown"
              @pointermove="onZoomPointerMove"
              @pointerup="onZoomPointerUp"
              @pointercancel="onZoomPointerUp"
            />
          </div>

          <button
            v-if="props.items.length > 1"
            class="app-image-lightbox-button app-image-lightbox-nav"
            type="button"
            aria-label="下一张图片"
            @click="move(1)"
          >
            <span class="i-mingcute-right-line size-5" aria-hidden="true" />
          </button>
        </div>

        <footer class="app-image-lightbox-footer" @click.self="close">
          <div class="app-image-lightbox-controls">
            <button class="app-image-lightbox-tool" type="button" aria-label="缩小" @click="zoomOut">
              <span class="i-mingcute-zoom-out-line size-4" aria-hidden="true" />
            </button>
            <button
              class="app-image-lightbox-tool app-image-lightbox-zoom-value"
              type="button"
              aria-label="重置缩放"
              title="重置缩放"
              @click="resetZoom"
            >
              {{ zoomPercentage }}
            </button>
            <button class="app-image-lightbox-tool" type="button" aria-label="放大" @click="zoomIn">
              <span class="i-mingcute-zoom-in-line size-4" aria-hidden="true" />
            </button>
          </div>
          <AppImageLightboxFilmstrip
            v-if="props.items.length > 1"
            :items="props.items"
            :active-index="activeIndex"
            @select="index => (activeIndex = index)"
          />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style lang="scss">
.app-image-lightbox-overlay {
  @apply fixed inset-0 z-50;

  background: rgb(0 0 0 / 0.82);
}

.app-image-lightbox {
  @apply fixed inset-0 z-50 flex flex-col outline-none;
}

.app-image-lightbox-button {
  @apply flex-center size-10 shrink-0 cursor-pointer rounded-full border-0 p-0 outline-none transition-colors duration-150;

  background: rgb(255 255 255 / 0.08);
  color: rgb(255 255 255 / 0.85);
}

.app-image-lightbox-button:hover {
  background: rgb(255 255 255 / 0.18);
  color: rgb(255 255 255 / 1);
}

.app-image-lightbox-button:focus-visible {
  box-shadow: 0 0 0 2px rgb(255 255 255 / 0.6);
}

.app-image-lightbox-close {
  @apply absolute right-4 top-4 z-10;
}

.app-image-lightbox-stage {
  @apply flex min-h-0 flex-1 items-center justify-center gap-4 px-4 pt-14;
}

.app-image-lightbox-viewport {
  @apply flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch;
}

.app-image-lightbox-image {
  @apply max-h-full max-w-full object-contain;

  box-shadow: 0 8px 40px rgb(0 0 0 / 0.5);
}

.app-image-lightbox-image-pannable {
  cursor: grab;
}

.app-image-lightbox-image-panning {
  cursor: grabbing;
}

.app-image-lightbox-hint {
  @apply px-6 text-center text-sm;

  color: rgb(255 255 255 / 0.82);
}

.app-image-lightbox-error {
  color: var(--destructive-foreground);
}

.app-image-lightbox-footer {
  @apply flex shrink-0 flex-col items-center gap-2 px-4 pb-4 pt-3;
}

.app-image-lightbox-controls {
  @apply flex items-center gap-1.5;
}

.app-image-lightbox-tool {
  @apply flex-center h-7 min-w-7 cursor-pointer rounded-full border-0 p-0 px-1.5 text-xs outline-none transition-colors duration-150;

  background: rgb(255 255 255 / 0.08);
  color: rgb(255 255 255 / 0.85);
}

.app-image-lightbox-tool:hover {
  background: rgb(255 255 255 / 0.18);
  color: rgb(255 255 255 / 1);
}

.app-image-lightbox-tool:focus-visible {
  box-shadow: 0 0 0 2px rgb(255 255 255 / 0.6);
}

.app-image-lightbox-zoom-value {
  @apply min-w-12 tabular-nums;
}

.app-image-lightbox-counter {
  @apply absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs;

  background: rgb(255 255 255 / 0.08);
  color: rgb(255 255 255 / 0.85);
}
</style>
