import { onScopeDispose, ref, watch, type Ref } from 'vue';

import type { Entry } from '@chaptale/creation/contracts';
import type { FileAction } from '@chaptale/desktop/bridge';

import { getDesktopApi } from '@/utils/desktop-api';

const imageTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
};

/** “打开方式”对话框只有 Windows 提供。 */
export const canChooseOpener = /Windows/.test(navigator.userAgent);

/** 每次读取磁盘上的当前文件，外部修改后再次打开即显示新内容。 */
export async function readFileBlob(workId: string, entry: Entry): Promise<Blob> {
  const data = await getDesktopApi().creation.readFile({ workId, entryId: entry.id });
  const extension = entry.fileName!.split('.').pop()!.toLowerCase();
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: imageTypes[extension] ?? '' });
}

export function runFileAction(workId: string, entry: Entry, action: FileAction) {
  return getDesktopApi().creation.fileAction({ workId, entryId: entry.id }, action);
}

/** 图片条目的 Object URL；目标变化或作用域结束时释放。读取失败返回 null，由调用方显示占位。 */
export function useFileImage(target: Ref<{ workId: string; entry: Entry } | null>) {
  const src = ref<string | null>(null);
  let sequence = 0;
  function release() {
    if (src.value) URL.revokeObjectURL(src.value);
    src.value = null;
  }
  watch(
    () => target.value && `${target.value.workId}/${target.value.entry.id}`,
    async key => {
      const current = ++sequence;
      release();
      if (!key) return;
      const blob = await readFileBlob(target.value!.workId, target.value!.entry).catch(() => null);
      if (current === sequence && blob) src.value = URL.createObjectURL(blob);
    },
    { immediate: true }
  );
  onScopeDispose(() => {
    sequence++;
    release();
  });
  return src;
}
