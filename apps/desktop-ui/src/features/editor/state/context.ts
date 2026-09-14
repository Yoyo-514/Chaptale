import type { ShallowRef } from 'vue';

import type { DocumentBuffer } from '../codemirror/document-buffer';
import type { EditorTab } from '../types';

/**
 * 编辑器内部协作边界：共享文档身份和事务，不把整个 Pinia store 相互传递。
 * revision 区分“关闭后重新打开同一路径”，仅比较 rootPath 不足以判定异步结果是否有效。
 */
export type EditorDocumentContext = {
  tabs: ShallowRef<EditorTab[]>;
  buffers: Map<string, DocumentBuffer>;
  saves: Map<string, Promise<boolean>>;
  autoSaveTimers: Map<string, ReturnType<typeof setTimeout>>;
  workspace: { rootPath: string | null; revision: number };
  replaceTab: (tab: EditorTab) => void;
};
