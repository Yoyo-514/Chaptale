import { ref, shallowRef } from 'vue';

import type { DocumentBuffer } from './codemirror/document-buffer';
import type { EditorTab } from './types';

/** 打开的文稿：标签记录与各自的编辑缓冲，按文稿的稳定 ID 索引。 */
export function createOpenDocuments() {
  const tabs = shallowRef<EditorTab[]>([]);
  const bufferVersions = ref<Record<string, number>>({});
  const buffers = new Map<string, DocumentBuffer>();
  function find(id: string) {
    return tabs.value.find(tab => tab.id === id);
  }
  function patch(id: string, fields: Partial<EditorTab>) {
    tabs.value = tabs.value.map(tab => (tab.id === id ? { ...tab, ...fields } : tab));
  }
  function bumpBufferVersion(id: string) {
    bufferVersions.value = { ...bufferVersions.value, [id]: (bufferVersions.value[id] ?? 0) + 1 };
  }
  return { tabs, bufferVersions, buffers, find, patch, bumpBufferVersion };
}

export type OpenDocuments = ReturnType<typeof createOpenDocuments>;
