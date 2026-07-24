import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

import type { AppImagePreviewItem } from './types';

const ORIGINAL_IMAGE_CACHE_LIMIT = 5;

/**
 * 懒加载当前原图，并预加载相邻图片。
 *
 * Object URL 使用小容量 LRU 缓存，兼顾短距离往返浏览和明确的内存上界；关闭预览时
 * 立即释放全部缓存。同一图片的前台加载与后台预加载复用一个请求。
 */
export function useOriginalImage(
  currentItem: Ref<AppImagePreviewItem | undefined>,
  preloadItems: Ref<readonly AppImagePreviewItem[]>
) {
  const originalSrc = ref('');
  const isLoading = ref(false);
  const errorMessage = ref('');
  let requestSequence = 0;
  let isActive = false;
  let activeGeneration = 0;
  let currentItemId = '';
  const objectUrls = new Map<string, string>();
  const pendingLoads = new Map<string, Promise<string | undefined>>();

  function releaseObjectUrl(itemId: string) {
    const objectUrl = objectUrls.get(itemId);

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(itemId);
    }
  }

  function clearCache() {
    while (objectUrls.size > 0) {
      releaseObjectUrl(objectUrls.keys().next().value!);
    }
  }

  function getCachedObjectUrl(itemId: string) {
    const objectUrl = objectUrls.get(itemId);

    if (objectUrl) {
      // Map 保持插入顺序；重新插入命中项，使首项始终是最久未使用的缓存。
      objectUrls.delete(itemId);
      objectUrls.set(itemId, objectUrl);
    }

    return objectUrl;
  }

  function getOldestEvictableItemId() {
    for (const itemId of objectUrls.keys()) {
      if (itemId !== currentItemId) {
        return itemId;
      }
    }

    return undefined;
  }

  function cacheObjectUrl(itemId: string, objectUrl: string) {
    objectUrls.set(itemId, objectUrl);

    while (objectUrls.size > ORIGINAL_IMAGE_CACHE_LIMIT) {
      const oldestItemId = getOldestEvictableItemId();

      if (!oldestItemId) {
        break;
      }

      releaseObjectUrl(oldestItemId);
    }
  }

  function loadIntoCache(item: AppImagePreviewItem) {
    const cached = getCachedObjectUrl(item.id);

    if (cached) {
      return Promise.resolve(cached);
    }

    const pending = pendingLoads.get(item.id);

    if (pending) {
      return pending;
    }

    const loadGeneration = activeGeneration;
    const load = item
      .loadOriginal()
      .then(blob => {
        // IPC 读取本身无法取消；预览关闭后不再为已完成的旧请求创建 object URL。
        if (!isActive || loadGeneration !== activeGeneration) {
          return undefined;
        }

        const objectUrl = URL.createObjectURL(blob);
        cacheObjectUrl(item.id, objectUrl);
        return objectUrl;
      })
      .finally(() => {
        // 关闭后重新打开可能已为同一图片创建新请求，旧请求不得移除新的索引。
        if (pendingLoads.get(item.id) === load) {
          pendingLoads.delete(item.id);
        }
      });

    pendingLoads.set(item.id, load);
    return load;
  }

  function synchronize() {
    const item = currentItem.value;
    const sequence = ++requestSequence;
    isActive = Boolean(item);
    currentItemId = item?.id ?? '';
    originalSrc.value = '';
    errorMessage.value = '';
    isLoading.value = Boolean(item);

    if (!item) {
      activeGeneration += 1;
      pendingLoads.clear();
      clearCache();
      return;
    }

    void loadIntoCache(item)
      .then(objectUrl => {
        if (sequence === requestSequence && objectUrl) {
          originalSrc.value = objectUrl;
        }
      })
      .catch(error => {
        if (sequence === requestSequence) {
          errorMessage.value = error instanceof Error ? error.message : '图片加载失败';
        }
      })
      .finally(() => {
        if (sequence === requestSequence) {
          isLoading.value = false;
        }
      });

    const preloadedItemIds = new Set([item.id]);

    for (const preloadItem of preloadItems.value) {
      if (!preloadedItemIds.has(preloadItem.id)) {
        preloadedItemIds.add(preloadItem.id);
        // 预加载失败不影响当前图片；切换到该图片时会重新请求并展示错误。
        void loadIntoCache(preloadItem).catch(() => undefined);
      }
    }
  }

  watch([currentItem, preloadItems], synchronize, { immediate: true });

  onBeforeUnmount(() => {
    requestSequence += 1;
    isActive = false;
    activeGeneration += 1;
    currentItemId = '';
    pendingLoads.clear();
    clearCache();
  });

  return { originalSrc, isLoading, errorMessage };
}
