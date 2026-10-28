import { nextTick, ref, shallowRef, watch } from 'vue';

import { isImageFile, type Entry } from '@chaptale/creation/contracts';

import { useCreationStore } from '@/features/creation';
import { useNotificationStore } from '@/features/notifications';
import { toErrorMessage } from '@/utils/desktop-api';

import type { IllustrationOptions } from '../codemirror/illustrations';
import { useEditorStore } from '../store';
import type { EditorTab } from '../types';
import { useIllustrationImages } from './images';

interface IllustrationTarget {
  cursorLineEnd(): number;
  insertIllustration(after: number, illustration: { caption: string; entryId: string }): number;
  reloadIllustrations(): void;
}

const entryType = 'application/chaptale-entry';

/** 正文插图：图片读取与缓存、三种插入入口，以及 TXT 文稿插入前转为 Markdown 的确认。 */
export function useIllustrations(tab: () => EditorTab, target: () => IllustrationTarget | undefined) {
  const creation = useCreationStore();
  const editor = useEditorStore();
  const notifications = useNotificationStore();
  const images = useIllustrationImages(() => tab().workId);
  const pickerOpen = ref(false);
  let pickerAfter = 0;
  // 确认框关闭先于确认事件，待执行的插入与打开状态分开保存。
  const convertOpen = ref(false);
  let convertAction: (() => Promise<void>) | null = null;
  const previewEntry = shallowRef<Entry | null>(null);

  // 图片条目移入、移出回收站或被清空后重新读取。
  watch(
    () =>
      creation.entries
        .filter(isImageFile)
        .map(entry => entry.id)
        .join(),
    () => {
      images.reset();
      target()?.reloadIllustrations();
    }
  );

  function insert(after: number, entries: Entry[]) {
    let at = after;
    for (const entry of entries)
      at = target()!.insertIllustration(at, {
        // 说明取图片标题去掉扩展名；] 与换行会破坏插图语法。
        caption: entry.title.replace(/\.[^.]+$/, '').replace(/[\]\n]/g, ''),
        entryId: entry.id
      });
  }
  function run(action: () => Promise<void> | void) {
    const guarded = async () => {
      try {
        await action();
      } catch (cause) {
        notifications.error('插入插图失败', toErrorMessage(cause));
      }
    };
    if (tab().format === 'markdown') void guarded();
    else {
      convertAction = guarded;
      convertOpen.value = true;
    }
  }
  async function confirmConvert() {
    const action = convertAction!;
    convertAction = null;
    editor.updateMetadata(tab().id, { format: 'markdown' });
    // 等格式变化重建编辑器后再插入。
    await nextTick();
    await action();
  }

  const options: Omit<IllustrationOptions, 'render'> = {
    load: images.load,
    peek: images.peek,
    preview(entryId) {
      previewEntry.value = creation.entries.find(entry => entry.id === entryId) ?? null;
    },
    drop(event, after) {
      const data = event instanceof DragEvent ? event.dataTransfer! : event.clipboardData!;
      const entryId = data.getData(entryType);
      if (entryId) {
        const entry = creation.entries.find(item => item.id === entryId);
        if (entry && isImageFile(entry)) run(() => insert(after, [entry]));
        else notifications.error('无法插入插图', '只能插入资料中的图片');
        return true;
      }
      const files = [...data.files];
      if (!files.length) return false;
      const pictures = files.filter(file => file.type.startsWith('image/'));
      if (pictures.length) run(async () => insert(after, await creation.addIllustrationFiles(pictures)));
      else notifications.error('无法插入插图', '只能插入图片文件');
      return true;
    }
  };

  return {
    options,
    pickerOpen,
    previewEntry,
    convertOpen,
    confirmConvert,
    openPicker() {
      pickerAfter = target()!.cursorLineEnd();
      pickerOpen.value = true;
    },
    pick(entry: Entry) {
      run(() => insert(pickerAfter, [entry]));
    }
  };
}
