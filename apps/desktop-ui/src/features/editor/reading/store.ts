import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

import type { Document, EditorGroupIndex } from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore } from '@/features/creation';

import { useEditorStore } from '../store';

/** 阅读位置：读到的章节与正文偏移。 */
export interface ReadingPosition {
  documentId: string;
  offset: number;
}

export function readingSlotKey(groupIndex: EditorGroupIndex, tabId: string): string {
  return groupIndex === 0 ? tabId : `1:${tabId}`;
}

/** 按编辑组与标签记录阅读状态；切回编辑时交给所在组的文档视图定位。 */
export const useReadingStore = defineStore('reading', () => {
  const editor = useEditorStore();
  const creation = useCreationStore();
  const positions = ref<Record<string, ReadingPosition>>({});
  const viewports = new Map<string, HTMLElement>();

  function bindViewport(slot: string, element: HTMLElement | null) {
    if (element) viewports.set(slot, element);
    else viewports.delete(slot);
  }
  function selectedText(slot: string): string {
    const viewport = viewports.get(slot);
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!viewport || !selection || selection.isCollapsed) return '';
    return viewport.contains(selection.anchorNode) && viewport.contains(selection.focusNode)
      ? selection.toString()
      : '';
  }
  /** 切回编辑后待定位的编辑组、文稿与正文位置，由对应文档视图挂载后消费。 */
  const reveal = shallowRef<{ groupIndex: EditorGroupIndex; id: string; offset: number } | null>(null);

  function stop(slot: string) {
    if (!(slot in positions.value)) return;
    const next = { ...positions.value };
    delete next[slot];
    positions.value = next;
    viewports.delete(slot);
  }

  // 标签从所在组关闭后清掉它的阅读状态，重新打开时回到编辑。
  watch(
    () =>
      editor.groups.map((group, index) =>
        group.tabs.map(tab => readingSlotKey(index as EditorGroupIndex, tab.documentId))
      ),
    groupSlots => {
      const valid = new Set(groupSlots.flat());
      for (const slot of Object.keys(positions.value)) {
        if (!valid.has(slot)) stop(slot);
      }
    },
    { deep: true }
  );

  /** 双栏合并回单栏时迁移保留组的阅读状态。 */
  function onGroupCollapsed(keptGroup: EditorGroupIndex) {
    const next: Record<string, ReadingPosition> = {};
    for (const [key, pos] of Object.entries(positions.value)) {
      const isRight = key.startsWith('1:');
      if (keptGroup === 0 && !isRight) next[key] = pos;
      else if (keptGroup === 1 && isRight) next[key.slice(2)] = pos;
    }
    positions.value = next;
  }

  /** 从当前编辑组的光标所在位置开始阅读。 */
  function start(tabId: string, groupIndex: EditorGroupIndex = editor.activeGroup) {
    const tab = editor.tabs.find(item => item.id === tabId)!;
    const slot = readingSlotKey(groupIndex, tabId);
    remember(slot, { documentId: tabId, offset: editor.viewState(tab, groupIndex)?.anchor ?? 0 });
  }
  function remember(slot: string, position: ReadingPosition) {
    positions.value = { ...positions.value, [slot]: position };
  }
  /** 已打开的章节读编辑区当前文字，其他章节读已保存正文。 */
  async function readChapter(
    documentId: string
  ): Promise<{ id: string; title: string; format: Document['format']; content: string }> {
    const tab = editor.tabs.find(item => item.id === documentId);
    const buffer = editor.getBuffer(documentId);
    if (tab?.status === 'ready' && buffer)
      return { id: tab.id, title: tab.title, format: tab.format, content: buffer.content };
    const document = await requestCreation('readDocument', { workId: creation.workId!, documentId });
    return { id: document.id, title: document.title, format: document.format, content: document.content };
  }
  /** 结束阅读，在当前编辑组打开或切到读到的章节并定位正文。 */
  async function edit(tabId: string, groupIndex: EditorGroupIndex = editor.activeGroup) {
    const slot = readingSlotKey(groupIndex, tabId);
    const { documentId, offset } = positions.value[slot]!;
    stop(slot);
    reveal.value = { groupIndex, id: documentId, offset };
    await editor.openDocument(documentId, true, groupIndex);
  }
  /** 文档视图挂载后取走属于自己所在编辑组的定位请求。 */
  function takeReveal(documentId: string, groupIndex: EditorGroupIndex = 0) {
    const target = reveal.value;
    if (!target || target.id !== documentId || target.groupIndex !== groupIndex) return null;
    reveal.value = null;
    return target.offset;
  }

  return {
    positions,
    reveal,
    slotKey: readingSlotKey,
    start,
    stop,
    remember,
    onGroupCollapsed,
    bindViewport,
    selectedText,
    readChapter,
    edit,
    takeReveal
  };
});
