import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import { MAX_DOCUMENT_BYTES } from '@chaptale/ipc-contract';

import { useSettingsStore } from '@/features/settings';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';
import { registerWorkspaceTransitionGuard } from '@/utils/workspace-transition';

import type { DocumentBuffer } from './codemirror/document-buffer';
import { NORMAL_PREVIEW_BYTES, type DocumentViewState, type EditorTab } from './types';
import { countDocumentWords } from './word-count';

/** 标签是磁盘快照与在内存中编辑的缓冲投影；保存必须带原始磁盘基线。 */
export const useEditorStore = defineStore('editor', () => {
  const workspace = useWorkspaceStore();
  const settings = useSettingsStore();
  const tabs = shallowRef<EditorTab[]>([]);
  const activeId = ref('');
  const searchRequest = ref(0);
  const newChapterOpen = ref(false);
  const command = shallowRef<{ name: 'undo' | 'redo'; sequence: number } | null>(null);
  const unsavedPrompt = shallowRef<{ paths: string[] } | null>(null);
  const buffers = new Map<string, DocumentBuffer>();
  const saves = new Map<string, Promise<boolean>>();
  const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const wordCountTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, symbol>();
  let decision:
    | { promise: Promise<'save' | 'discard' | 'cancel'>; resolve: (choice: 'save' | 'discard' | 'cancel') => void }
    | undefined;
  let nextId = 0;

  const activeTab = computed(() => tabs.value.find(tab => tab.id === activeId.value) ?? null);
  const hasUnsaved = computed(() => tabs.value.some(tab => tab.dirty || tab.saving));
  const autoSave = computed(() => settings.state?.settings.editor?.autoSave ?? false);
  let windowClosingApproved = false;
  let closingWindow: Promise<void> | undefined;

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
    if ((tab.dirty || tab.saving) && !(await confirmClose([id]))) return;
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
        buffers.delete(id);
        replaceTab({
          ...current,
          status: 'ready',
          document: result.document,
          error: null,
          readonly: result.document.sizeBytes > NORMAL_PREVIEW_BYTES,
          dirty: false,
          saveError: '',
          generation: (current.generation ?? 0) + 1
        });
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

  async function closeTab(id: string) {
    const tab = tabs.value.find(item => item.id === id);
    if ((tab?.dirty || tab?.saving) && !(await confirmClose([id]))) return;
    const index = tabs.value.findIndex(item => item.id === id);
    if (index < 0) return;
    pending.delete(id);
    buffers.delete(id);
    clearTimeout(autoSaveTimers.get(id));
    autoSaveTimers.delete(id);
    clearTimeout(wordCountTimers.get(id));
    wordCountTimers.delete(id);
    tabs.value = tabs.value.filter(item => item.id !== id);
    if (activeId.value === id) activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.id ?? '';
  }

  function rememberView(id: string, viewState: DocumentViewState) {
    const tab = tabs.value.find(item => item.id === id);
    if (tab) replaceTab({ ...tab, viewState });
  }

  function requestSearch() {
    if (activeTab.value?.status === 'ready') searchRequest.value += 1;
  }

  function requestCommand(name: 'undo' | 'redo') {
    command.value = { name, sequence: (command.value?.sequence ?? 0) + 1 };
  }

  function updateBuffer(id: string, buffer: DocumentBuffer) {
    const tab = tabs.value.find(item => item.id === id);
    if (!tab) return;
    buffers.set(id, buffer);
    replaceTab({ ...tab, dirty: buffer.dirty });
    clearTimeout(wordCountTimers.get(id));
    wordCountTimers.set(
      id,
      setTimeout(() => {
        wordCountTimers.delete(id);
        const current = tabs.value.find(item => item.id === id);
        if (current && buffers.get(id) === buffer) {
          replaceTab({ ...current, words: countDocumentWords(buffer.state.doc.toString()) });
        }
      }, 200)
    );
    clearTimeout(autoSaveTimers.get(id));
    if (autoSave.value && buffer.dirty && !tab.saveError) {
      autoSaveTimers.set(
        id,
        setTimeout(() => {
          if (autoSave.value) void saveDocument(id);
        }, 1200)
      );
    }
  }

  async function saveDocument(id = activeId.value): Promise<boolean> {
    const underway = saves.get(id);
    if (underway) {
      if (!(await underway)) return false;
      return saveDocument(id);
    }
    const tab = tabs.value.find(item => item.id === id);
    const buffer = buffers.get(id);
    if (!tab?.document || !buffer || tab.readonly || !tab.dirty) return !tab?.dirty;
    const sentState = buffer.state;
    const content = buffer.content;
    const document = tab.document;
    replaceTab({ ...tab, saving: true, saveError: '' });
    const save = (async () => {
      try {
        const result = await getDesktopApi().workspace.writeDocument({
          rootPath: document.rootPath,
          relativePath: tab.path,
          expectedHash: document.contentHash,
          content
        });
        const current = tabs.value.find(item => item.id === id);
        if (!current || buffers.get(id) !== buffer || workspace.rootPath !== document.rootPath) return false;
        if (!result.ok) {
          replaceTab({ ...current, saving: false, saveError: result.message });
          return false;
        }
        buffer.markSaved(sentState);
        replaceTab({ ...current, document: result.document, dirty: buffer.dirty, saving: false, saveError: '' });
        return true;
      } catch (error) {
        const current = tabs.value.find(item => item.id === id);
        if (current) replaceTab({ ...current, saving: false, saveError: toErrorMessage(error) });
        return false;
      } finally {
        saves.delete(id);
      }
    })();
    saves.set(id, save);
    return save;
  }

  async function saveAll() {
    for (const tab of tabs.value) {
      if (!(await saveDocument(tab.id))) return false;
    }
    return !hasUnsaved.value;
  }

  async function confirmClose(ids = tabs.value.map(tab => tab.id)): Promise<boolean> {
    for (const id of ids) {
      const underway = saves.get(id);
      if (underway) await underway;
    }
    const dirty = tabs.value.filter(tab => ids.includes(tab.id) && tab.dirty);
    if (!dirty.length) return true;
    if (!decision) {
      let resolve!: (choice: 'save' | 'discard' | 'cancel') => void;
      const promise = new Promise<'save' | 'discard' | 'cancel'>(done => {
        resolve = done;
      });
      decision = { promise, resolve };
      unsavedPrompt.value = { paths: dirty.map(tab => tab.path) };
    } else if (unsavedPrompt.value) {
      unsavedPrompt.value = { paths: [...new Set([...unsavedPrompt.value.paths, ...dirty.map(tab => tab.path)])] };
    }
    const choice = await decision.promise;
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    for (const tab of dirty) {
      if (!(await saveDocument(tab.id))) return false;
    }
    return !tabs.value.some(tab => ids.includes(tab.id) && tab.dirty);
  }

  function resolveUnsaved(choice: 'save' | 'discard' | 'cancel') {
    decision?.resolve(choice);
    decision = undefined;
    unsavedPrompt.value = null;
  }

  const unregisterGuard = registerWorkspaceTransitionGuard(() => confirmClose());

  async function setAutoSave(value: boolean) {
    await settings.update({ editor: { autoSave: value } });
    if (autoSave.value) await saveAll();
  }

  function requestWindowClose(): Promise<void> {
    // 先确认收到请求，作者可以在保存对话框中停留，不被当成窗口失联。
    void getDesktopApi().windowControl.completeClose(false);
    if (closingWindow) return closingWindow;
    closingWindow = (async () => {
      if (!(await confirmClose())) {
        await getDesktopApi().windowControl.completeClose(false);
        return;
      }
      windowClosingApproved = true;
      try {
        await getDesktopApi().windowControl.completeClose(true);
      } catch (error) {
        windowClosingApproved = false;
        throw error;
      }
    })().finally(() => {
      closingWindow = undefined;
    });
    return closingWindow;
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!hasUnsaved.value || windowClosingApproved) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function reset() {
    pending.clear();
    buffers.clear();
    for (const timer of autoSaveTimers.values()) clearTimeout(timer);
    autoSaveTimers.clear();
    for (const timer of wordCountTimers.values()) clearTimeout(timer);
    wordCountTimers.clear();
    resolveUnsaved('cancel');
    tabs.value = [];
    activeId.value = '';
    newChapterOpen.value = false;
  }

  watch(() => [workspace.rootPath, workspace.revision], reset, { flush: 'sync' });
  onScopeDispose(() => {
    unregisterGuard();
    reset();
  });

  return {
    tabs,
    activeId,
    activeTab,
    searchRequest,
    newChapterOpen,
    command,
    hasUnsaved,
    unsavedPrompt,
    autoSave,
    getBuffer: (id: string) => buffers.get(id),
    updateBuffer,
    saveDocument,
    saveAll,
    confirmClose,
    resolveUnsaved,
    requestCommand,
    setAutoSave,
    requestWindowClose,
    handleBeforeUnload,
    openDocument,
    reloadDocument,
    selectTab,
    closeTab,
    rememberView,
    requestSearch,
    reset
  };
});
