import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

import type { AppImagePreviewItem } from './types';

/** 懒加载当前图片的原图，管理 objectURL 生命周期并丢弃过期请求。 */
export function useOriginalImage(currentItem: Ref<AppImagePreviewItem | undefined>) {
  const originalSrc = ref('');
  const isLoading = ref(false);
  const errorMessage = ref('');
  let requestSequence = 0;
  let loadedItemId = '';
  let objectUrl = '';

  function releaseObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    }
  }

  function reset() {
    requestSequence += 1;
    loadedItemId = '';
    originalSrc.value = '';
    errorMessage.value = '';
    isLoading.value = false;
    releaseObjectUrl();
  }

  async function load(item: AppImagePreviewItem) {
    const sequence = ++requestSequence;
    loadedItemId = item.id;
    releaseObjectUrl();
    originalSrc.value = '';
    errorMessage.value = '';
    isLoading.value = true;

    try {
      const blob = await item.loadOriginal();

      if (sequence !== requestSequence) {
        return;
      }

      objectUrl = URL.createObjectURL(blob);
      originalSrc.value = objectUrl;
    } catch (error) {
      if (sequence === requestSequence) {
        errorMessage.value = error instanceof Error ? error.message : '图片加载失败';
      }
    } finally {
      if (sequence === requestSequence) {
        isLoading.value = false;
      }
    }
  }

  watch(
    currentItem,
    item => {
      if (!item) {
        reset();
        return;
      }

      // 列表引用变化会重新触发 watch；同一张图且未失败时无需重新加载。
      if (item.id === loadedItemId && !errorMessage.value) {
        return;
      }

      void load(item);
    },
    { immediate: true }
  );

  onBeforeUnmount(reset);

  return { originalSrc, isLoading, errorMessage };
}
