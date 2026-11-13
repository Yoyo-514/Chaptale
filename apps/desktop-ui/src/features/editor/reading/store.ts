import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

import type { Document } from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore } from '@/features/creation';

import { useEditorStore } from '../store';

/** 阅读位置：读到的章节与正文偏移。 */
export interface ReadingPosition {
  documentId: string;
  offset: number;
}

/** 按标签记录阅读状态；切回编辑时交给文档视图定位。 */
export const useReadingStore = defineStore('reading', () => {
  const editor = useEditorStore();
  const creation = useCreationStore();
  const positions = ref<Record<string, ReadingPosition>>({});
  const viewports = new Map<string, HTMLElement>();
  function bindViewport(tabId: string, element: HTMLElement | null) {
    if (element) viewports.set(tabId, element);
    else viewports.delete(tabId);
  }
  function selectedText(tabId: string): string {
    const viewport = viewports.get(tabId);
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!viewport || !selection || selection.isCollapsed) return '';
    return viewport.contains(selection.anchorNode) && viewport.contains(selection.focusNode)
      ? selection.toString()
      : '';
  }
  /** 切回编辑后待定位的文稿与正文位置，由文档视图挂载后消费。 */
  const reveal = shallowRef<{ id: string; offset: number } | null>(null);

  function stop(tabId: string) {
    if (!(tabId in positions.value)) return;
    const next = { ...positions.value };
    delete next[tabId];
    positions.value = next;
    viewports.delete(tabId);
  }
  // 标签关闭后清掉它的阅读状态，重新打开时回到编辑。
  watch(
    () => editor.tabs,
    tabs => {
      for (const tabId of Object.keys(positions.value)) if (!tabs.some(tab => tab.id === tabId)) stop(tabId);
    }
  );

  /** 从光标所在位置开始阅读。 */
  function start(tabId: string) {
    const tab = editor.tabs.find(item => item.id === tabId)!;
    remember(tabId, { documentId: tabId, offset: editor.viewState(tab)?.anchor ?? 0 });
  }
  function remember(tabId: string, position: ReadingPosition) {
    positions.value = { ...positions.value, [tabId]: position };
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
  /** 结束阅读，打开或切到读到的章节并定位正文；原标签保持不变。 */
  async function edit(tabId: string) {
    const { documentId, offset } = positions.value[tabId]!;
    stop(tabId);
    reveal.value = { id: documentId, offset };
    await editor.openDocument(documentId);
  }
  /** 文档视图挂载后取走属于自己的定位请求。 */
  function takeReveal(documentId: string) {
    const target = reveal.value;
    if (target?.id !== documentId) return null;
    reveal.value = null;
    return target.offset;
  }

  return {
    positions,
    reveal,
    start,
    remember,
    bindViewport,
    selectedText,
    readChapter,
    edit,
    takeReveal
  };
});
