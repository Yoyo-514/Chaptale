import { onScopeDispose, ref } from 'vue';

import { readEntryImage } from '@/features/creation';
import { toErrorMessage } from '@/utils/desktop-api';

import type { IllustrationImage } from '../codemirror/illustrations';

/** 读取并解码图片，得到原始尺寸供插图占位；读取或解码失败转为占位文字。 */
async function decode(workId: string, entryId: string): Promise<IllustrationImage> {
  let blob: Blob;
  try {
    blob = await readEntryImage(workId, entryId);
  } catch (cause) {
    return { error: toErrorMessage(cause).includes('回收站') ? '图片在回收站中' : '插图已失效' };
  }
  const src = URL.createObjectURL(blob);
  const element = new Image();
  element.src = src;
  try {
    await element.decode();
  } catch {
    URL.revokeObjectURL(src);
    return { error: '图片无法显示' };
  }
  return { src, width: element.naturalWidth, height: element.naturalHeight };
}

/**
 * 插图图片的 Object URL 缓存：每个图片条目只读取一次，作用域结束或 reset 时释放。
 * images 为已读取完成的结果，供模板响应式显示。
 */
export function useIllustrationImages(workId: () => string) {
  const pending = new Map<string, Promise<IllustrationImage>>();
  const images = ref<Record<string, IllustrationImage>>({});

  function load(entryId: string) {
    let image = pending.get(entryId);
    if (!image) {
      image = decode(workId(), entryId);
      const current = image;
      void current.then(value => {
        if (pending.get(entryId) === current) images.value = { ...images.value, [entryId]: value };
      });
      pending.set(entryId, image);
    }
    return image;
  }
  function reset() {
    for (const image of pending.values()) void image.then(value => 'src' in value && URL.revokeObjectURL(value.src));
    pending.clear();
    images.value = {};
  }
  onScopeDispose(reset);
  return { images, load, reset, peek: (entryId: string) => images.value[entryId] };
}
