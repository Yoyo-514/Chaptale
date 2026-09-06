import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';

import { MAX_DOCUMENT_BYTES } from '@chaptale/ipc-contract';

import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { NORMAL_PREVIEW_BYTES, type DocumentViewState, type EditorTab } from './types';

/** 标签与只读磁盘快照的 UI 投影；不保存正文，也不将预览状态写回文件。 */
export const useEditorStore = defineStore('editor', () => {
  const workspace = useWorkspaceStore();
  const tabs = shallowRef<EditorTab[]>([]);
  const activeId = ref('');
  const searchRequest = ref(0);
  const pending = new Map<string, symbol>();
  let nextId = 0;

  const activeTab = computed(() => tabs.value.find(tab => tab.id === activeId.value) ?? null);

  function replaceTab(tab: EditorTab) {
    const index = tabs.value.findIndex(item => item.id === tab.id);
    if (index < 0) return;
    const next = tabs.value.slice();
    next[index] = tab;
    tabs.value = next;
  }

  function selectTab(id: string) {
    if (tabs.value.some(tab => tab.id === id)) activeId.value = id;
  }

  async function openDocument(relativePath: string) {
    if (!workspace.rootPath) return;
    const existing = tabs.value.find(tab => tab.path === relativePath);
    if (existing) {
      activeId.value = existing.id;
      return;
    }

    const tab: EditorTab = {
      id: `document-${++nextId}`,
      path: relativePath,
      title: relativePath.split('/').at(-1) ?? relativePath,
      readonly: true,
      dirty: false,
      status: 'loading',
      document: null,
      error: null,
      allowLarge: false
    };
    tabs.value = [...tabs.value, tab];
    activeId.value = tab.id;
    await reloadDocument(tab.id);
  }

  async function reloadDocument(id: string, allowLarge = false) {
    const tab = tabs.value.find(item => item.id === id);
    const rootPath = workspace.rootPath;
    if (!tab || !rootPath) return;
    const revision = workspace.revision;
    const token = Symbol();
    pending.set(id, token);
    replaceTab({ ...tab, status: 'loading', document: null, error: null, allowLarge: allowLarge || tab.allowLarge });
    const isCurrent = () =>
      pending.get(id) === token && workspace.rootPath === rootPath && workspace.revision === revision;

    try {
      const result = await getDesktopApi().workspace.readDocument({
        rootPath,
        relativePath: tab.path,
        maxBytes: allowLarge || tab.allowLarge ? MAX_DOCUMENT_BYTES : NORMAL_PREVIEW_BYTES
      });
      if (!isCurrent()) return;
      const current = tabs.value.find(item => item.id === id);
      if (!current) return;
      if (result.ok) {
        if (result.document.rootPath !== rootPath || result.document.relativePath !== tab.path) {
          replaceTab({
            ...current,
            status: 'error',
            error: { ok: false, code: 'workspace-changed', message: '文件读取结果已过期，请重新打开' }
          });
          return;
        }
        replaceTab({ ...current, status: 'ready', document: result.document, error: null });
      } else {
        replaceTab({ ...current, status: 'error', document: null, error: result });
      }
    } catch (error) {
      if (!isCurrent()) return;
      const current = tabs.value.find(item => item.id === id);
      if (current) {
        replaceTab({
          ...current,
          status: 'error',
          error: { ok: false, code: 'read-failed', message: toErrorMessage(error) }
        });
      }
    } finally {
      if (pending.get(id) === token) pending.delete(id);
    }
  }

  function closeTab(id: string) {
    const index = tabs.value.findIndex(tab => tab.id === id);
    if (index < 0) return;
    pending.delete(id);
    tabs.value = tabs.value.filter(tab => tab.id !== id);
    if (activeId.value === id) activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.id ?? '';
  }

  function rememberView(id: string, viewState: DocumentViewState) {
    const tab = tabs.value.find(item => item.id === id);
    if (tab) replaceTab({ ...tab, viewState });
  }

  function requestSearch() {
    if (activeTab.value?.status === 'ready') searchRequest.value += 1;
  }

  function reset() {
    pending.clear();
    tabs.value = [];
    activeId.value = '';
  }

  watch(() => [workspace.rootPath, workspace.revision], reset, { flush: 'sync' });

  return {
    tabs,
    activeId,
    activeTab,
    searchRequest,
    openDocument,
    reloadDocument,
    selectTab,
    closeTab,
    rememberView,
    requestSearch,
    reset
  };
});
