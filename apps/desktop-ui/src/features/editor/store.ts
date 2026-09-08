import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import {
  MAX_DOCUMENT_BYTES,
  type RecoverySummary,
  type WorkspaceChanged,
  type WorkspaceDocument
} from '@chaptale/ipc-contract';

import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';
import { registerWorkspaceTransitionGuard } from '@/utils/workspace-transition';

import { DocumentBuffer } from './codemirror/document-buffer';
import { NORMAL_PREVIEW_BYTES, type DocumentViewState, type EditorTab } from './types';
import { countDocumentWords } from './word-count';

/** 标签是磁盘快照与在内存中编辑的缓冲投影；保存必须带原始磁盘基线。 */
export const useEditorStore = defineStore('editor', () => {
  const workspace = useWorkspaceStore();
  const settings = useSettingsStore();
  const tabs = shallowRef<EditorTab[]>([]);
  const activeId = ref('');
  const searchRequest = ref(0);
  const location = shallowRef<{ path: string; from: number; to: number; sequence: number } | null>(null);
  const newChapterOpen = ref(false);
  const command = shallowRef<{ name: 'undo' | 'redo'; sequence: number } | null>(null);
  const unsavedPrompt = shallowRef<{ paths: string[] } | null>(null);
  const recoveries = shallowRef<RecoverySummary[]>([]);
  const recoveryError = ref('');
  const conflictId = ref('');
  const conflictTab = computed(() => tabs.value.find(tab => tab.id === conflictId.value) ?? null);
  const buffers = new Map<string, DocumentBuffer>();
  const saves = new Map<string, Promise<boolean>>();
  const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const wordCountTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const recoveryWrites = new Map<string, Promise<void>>();
  const externalReads = new Map<string, symbol>();
  let recoveryLoad = 0;
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

  async function openDocument(relativePath: string, reveal = true) {
    if (!workspace.rootPath) return;
    if (reveal) useWorkbenchStore().center = 'editor';
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
        if (result.document.sizeBytes <= NORMAL_PREVIEW_BYTES)
          buffers.set(id, new DocumentBuffer(result.document.content));
        else buffers.delete(id);
        replaceTab({
          ...current,
          status: 'ready',
          document: result.document,
          error: null,
          readonly: result.document.sizeBytes > NORMAL_PREVIEW_BYTES,
          dirty: false,
          saveError: '',
          external: undefined,
          recoveryBaseHash: undefined,
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
    removeTab(id);
  }
  function removeTab(id: string) {
    const index = tabs.value.findIndex(item => item.id === id);
    if (index < 0) return;
    pending.delete(id);
    buffers.delete(id);
    clearTimeout(autoSaveTimers.get(id));
    autoSaveTimers.delete(id);
    clearTimeout(recoveryTimers.get(id));
    recoveryTimers.delete(id);
    clearTimeout(wordCountTimers.get(id));
    wordCountTimers.delete(id);
    tabs.value = tabs.value.filter(item => item.id !== id);
    if (activeId.value === id) activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.id ?? '';
  }
  async function closeTabs(ids: string[]) {
    if (!(await confirmClose(ids))) return false;
    for (const id of ids) removeTab(id);
    return true;
  }
  function pathTabs(relativePath: string) {
    return tabs.value.filter(tab => tab.path === relativePath || tab.path.startsWith(`${relativePath}/`));
  }
  function acceptPathRemoval(relativePath: string) {
    for (const tab of pathTabs(relativePath)) removeTab(tab.id);
  }
  function acceptPathMove(from: string, to: string) {
    for (const tab of pathTabs(from)) {
      pending.delete(tab.id);
      externalReads.delete(tab.id);
      const nextPath = `${to}${tab.path.slice(from.length)}`;
      if (tab.dirty && tab.document) buffers.set(tab.id, new DocumentBuffer(tab.document.content));
      replaceTab({
        ...tab,
        path: nextPath,
        title: nextPath.split('/').at(-1) ?? nextPath,
        document: tab.document ? { ...tab.document, relativePath: nextPath } : null,
        dirty: false,
        external: undefined,
        saveError: '',
        generation: (tab.generation ?? 0) + 1
      });
    }
  }

  function rememberView(id: string, viewState: DocumentViewState) {
    const tab = tabs.value.find(item => item.id === id);
    if (tab) replaceTab({ ...tab, viewState });
  }

  function requestSearch() {
    if (activeTab.value?.status === 'ready') searchRequest.value += 1;
  }
  async function locate(path: string, from: number, to = from) {
    await openDocument(path);
    location.value = { path, from, to, sequence: (location.value?.sequence ?? 0) + 1 };
  }

  function requestCommand(name: 'undo' | 'redo') {
    command.value = { name, sequence: (command.value?.sequence ?? 0) + 1 };
  }

  function updateBuffer(id: string, buffer: DocumentBuffer) {
    const tab = tabs.value.find(item => item.id === id);
    if (!tab) return;
    buffers.set(id, buffer);
    replaceTab({ ...tab, dirty: buffer.dirty });
    if (buffer.dirty || tab.dirty) {
      clearTimeout(recoveryTimers.get(id));
      recoveryTimers.set(
        id,
        setTimeout(() => {
          void persistRecovery(id);
        }, 500)
      );
    }
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
    if (autoSave.value && buffer.dirty && !tab.saveError && !tab.external) {
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
    if (tab.external) {
      replaceTab({ ...tab, saveError: '磁盘文件已更新，请先处理版本冲突' });
      return false;
    }
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
        replaceTab({
          ...current,
          document: result.document,
          dirty: buffer.dirty,
          saving: false,
          saveError: '',
          recoveryBaseHash: undefined
        });
        await persistRecovery(id);
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

  /** 候选/版本写入与保存、watch、关闭共用同一队列，磁盘确认后只追加一个撤销事务。 */
  async function acceptDocumentChange<T extends { document: WorkspaceDocument }>(
    targetPath: string,
    expectedHash: string,
    action: () => Promise<T>
  ): Promise<T> {
    await openDocument(targetPath, false);
    const tab = tabs.value.find(value => value.path === targetPath);
    if (!tab?.document || tab.readonly || tab.dirty || tab.saving || tab.external)
      throw new Error('请先保存正文并处理磁盘冲突');
    if (tab.document.contentHash !== expectedHash) throw new Error('编辑器正文已变化，请重新读取候选');
    const buffer = buffers.get(tab.id) ?? new DocumentBuffer(tab.document.content);
    buffers.set(tab.id, buffer);
    buffer.setLocked(true);
    replaceTab({ ...tab, saving: true });
    let result: T | undefined;
    let failure: unknown;
    const operation = (async () => {
      try {
        result = await action();
        const current = tabs.value.find(value => value.id === tab.id);
        if (!current || workspace.rootPath !== result.document.rootPath)
          throw new Error('工作区已切换，写入结果将在重新打开时载入');
        buffer.replaceContent(result.document.content, true);
        buffer.markSaved(buffer.state);
        replaceTab({ ...current, document: result.document, dirty: false, saving: false, saveError: '' });
        await persistRecovery(tab.id);
        return true;
      } catch (cause) {
        failure = cause;
        const current = tabs.value.find(value => value.id === tab.id);
        if (current) replaceTab({ ...current, saving: false, saveError: toErrorMessage(cause) });
        return false;
      } finally {
        buffer.setLocked(false);
        saves.delete(tab.id);
      }
    })();
    saves.set(tab.id, operation);
    await operation;
    if (failure) throw failure;
    return result!;
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
    if (choice === 'discard') {
      for (const tab of dirty) {
        clearTimeout(autoSaveTimers.get(tab.id));
        clearTimeout(recoveryTimers.get(tab.id));
        if (tab.document) await discardRecovery(tab.path, tab.id);
      }
      return true;
    }
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

  async function queueRecovery(id: string, action: () => Promise<void>) {
    const previous = recoveryWrites.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    recoveryWrites.set(id, next);
    try {
      await next;
    } finally {
      if (recoveryWrites.get(id) === next) recoveryWrites.delete(id);
    }
  }

  async function persistRecovery(id: string) {
    clearTimeout(recoveryTimers.get(id));
    recoveryTimers.delete(id);
    const tab = tabs.value.find(item => item.id === id);
    const buffer = buffers.get(id);
    if (!tab?.document || !buffer) return;
    const { rootPath } = tab.document;
    const args = {
      rootPath,
      relativePath: tab.path,
      expectedHash: tab.recoveryBaseHash ?? tab.document.contentHash,
      content: buffer.content
    };
    const dirty = buffer.dirty;
    try {
      await queueRecovery(id, () =>
        dirty
          ? getDesktopApi().workspace.saveRecovery(args)
          : getDesktopApi().workspace.discardRecovery({ rootPath, relativePath: tab.path })
      );
      const current = tabs.value.find(item => item.id === id);
      if (current) replaceTab({ ...current, recoveryError: '' });
    } catch (error) {
      const current = tabs.value.find(item => item.id === id);
      if (current) replaceTab({ ...current, recoveryError: `恢复草稿未写入：${toErrorMessage(error)}` });
    }
  }

  async function loadRecoveries() {
    const token = ++recoveryLoad;
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    try {
      const list = (await getDesktopApi().workspace.listRecoveries?.({ rootPath })) ?? [];
      if (token === recoveryLoad && rootPath === workspace.rootPath) recoveries.value = list;
    } catch (error) {
      if (token === recoveryLoad) recoveryError.value = toErrorMessage(error);
    }
  }

  async function discardRecovery(relativePath: string, id = relativePath) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    try {
      await queueRecovery(id, () => getDesktopApi().workspace.discardRecovery({ rootPath, relativePath }));
      recoveries.value = recoveries.value.filter(item => item.relativePath !== relativePath);
    } catch (error) {
      recoveryError.value = toErrorMessage(error);
    }
  }

  async function restoreRecovery(relativePath: string) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    try {
      const draft = await getDesktopApi().workspace.readRecovery({ rootPath, relativePath });
      if (!draft || rootPath !== workspace.rootPath) return;
      const existing = tabs.value.find(tab => tab.path === relativePath);
      if (existing?.dirty && !(await confirmClose([existing.id]))) return;
      await openDocument(relativePath);
      const tab = tabs.value.find(item => item.path === relativePath);
      if (!tab || rootPath !== workspace.rootPath) return;
      const disk = tab.document;
      const document = disk ?? {
        rootPath,
        relativePath,
        content: '',
        head: { status: 'none' as const, body: '' },
        contentHash: draft.expectedHash,
        mtimeMs: 0,
        sizeBytes: 0
      };
      const buffer = buffers.get(tab.id) ?? new DocumentBuffer(document.content);
      buffers.set(tab.id, buffer);
      buffer.replaceContent(draft.content);
      replaceTab({
        ...tab,
        document,
        status: 'ready',
        error: null,
        readonly: false,
        dirty: buffer.dirty,
        recoveryBaseHash: draft.expectedHash,
        external:
          disk && disk.contentHash === draft.expectedHash
            ? undefined
            : disk
              ? { ok: true, document: disk }
              : { ok: false, code: 'not-found', message: '原文件已不存在，恢复稿仍保留，可另存副本' },
        notice: '已恢复上次未保存的草稿'
      });
      updateBuffer(tab.id, buffer);
      recoveries.value = recoveries.value.filter(item => item.relativePath !== relativePath);
    } catch (error) {
      recoveryError.value = toErrorMessage(error);
    }
  }

  async function handleWorkspaceChanged(event: WorkspaceChanged) {
    if (event.rootPath !== workspace.rootPath) return;
    if (event.error) recoveryError.value = `文件监听异常：${event.error}`;
    for (const tab of tabs.value) {
      if (
        !event.changes.some(
          change =>
            change.relativePath === tab.path ||
            (change.type === 'unlinkDir' && (!change.relativePath || tab.path.startsWith(`${change.relativePath}/`)))
        )
      )
        continue;
      if (saves.has(tab.id)) await saves.get(tab.id);
      const token = Symbol();
      externalReads.set(tab.id, token);
      try {
        const result = await getDesktopApi().workspace.readDocument({
          rootPath: event.rootPath,
          relativePath: tab.path,
          maxBytes: tab.allowLarge ? MAX_DOCUMENT_BYTES : NORMAL_PREVIEW_BYTES
        });
        if (workspace.rootPath !== event.rootPath || externalReads.get(tab.id) !== token) continue;
        const current = tabs.value.find(item => item.id === tab.id);
        if (!current?.document || (result.ok && result.document.contentHash === current.document.contentHash)) continue;
        if (!current.dirty && result.ok) {
          buffers.delete(tab.id);
          replaceTab({
            ...current,
            document: result.document,
            generation: (current.generation ?? 0) + 1,
            external: undefined,
            saveError: '',
            notice: '已载入磁盘更新'
          });
        } else {
          clearTimeout(autoSaveTimers.get(tab.id));
          replaceTab({
            ...current,
            external: result,
            notice: '',
            saveError: result.ok ? '磁盘文件已更新，本地修改仍保留' : result.message
          });
          if (current.dirty) await persistRecovery(tab.id);
        }
      } catch (error) {
        const current = tabs.value.find(item => item.id === tab.id);
        if (current) replaceTab({ ...current, saveError: toErrorMessage(error) });
      }
    }
  }

  async function acceptExternal(id: string) {
    const tab = tabs.value.find(item => item.id === id);
    if (!tab?.document) return;
    const result = await getDesktopApi().workspace.readDocument({
      rootPath: tab.document.rootPath,
      relativePath: tab.path
    });
    if (!result.ok) {
      replaceTab({ ...tab, saveError: result.message });
      return;
    }
    clearTimeout(autoSaveTimers.get(id));
    clearTimeout(recoveryTimers.get(id));
    await discardRecovery(tab.path, id);
    buffers.delete(id);
    replaceTab({
      ...tab,
      document: result.document,
      external: undefined,
      recoveryBaseHash: undefined,
      dirty: false,
      saveError: '',
      generation: (tab.generation ?? 0) + 1,
      notice: '已采用外部版本'
    });
    conflictId.value = '';
  }

  async function keepLocal(id: string) {
    const tab = tabs.value.find(item => item.id === id);
    const buffer = buffers.get(id);
    if (!tab?.external?.ok || !tab.document || !buffer || tab.saving) return;
    const rootPath = tab.document.rootPath;
    const expectedHash = tab.external.document.contentHash;
    const sentState = buffer.state;
    const content = buffer.content;
    replaceTab({ ...tab, saving: true });
    const operation = (async (): Promise<boolean> => {
      try {
        const result = await getDesktopApi().workspace.writeDocument({
          rootPath,
          relativePath: tab.path,
          expectedHash,
          content,
          preservePrevious: true
        });
        const current = tabs.value.find(item => item.id === id);
        if (!current) return false;
        if (!result.ok) {
          replaceTab({ ...current, saving: false, saveError: result.message });
          return false;
        }
        buffer.markSaved(sentState);
        replaceTab({
          ...current,
          document: result.document,
          external: undefined,
          recoveryBaseHash: undefined,
          dirty: buffer.dirty,
          saving: false,
          saveError: ''
        });
        await persistRecovery(id);
        conflictId.value = '';
        return true;
      } catch (error) {
        const current = tabs.value.find(item => item.id === id);
        if (current) replaceTab({ ...current, saving: false, saveError: toErrorMessage(error) });
        return false;
      } finally {
        saves.delete(id);
      }
    })();
    saves.set(id, operation);
    await operation;
  }

  async function saveConflictCopy(id: string, relativePath: string) {
    const tab = tabs.value.find(item => item.id === id);
    const buffer = buffers.get(id);
    if (!tab?.document || !buffer) return false;
    const rootPath = tab.document.rootPath;
    const created = await getDesktopApi().workspace.createEntry({ relativePath, kind: 'file' });
    if (!created.ok) throw new Error(created.message);
    const empty = await getDesktopApi().workspace.readDocument({ rootPath, relativePath });
    if (!empty.ok) throw new Error(empty.message);
    const result = await getDesktopApi().workspace.writeDocument({
      rootPath,
      relativePath,
      expectedHash: empty.document.contentHash,
      content: buffer.content
    });
    if (!result.ok) throw new Error(result.message);
    await openDocument(relativePath);
    conflictId.value = '';
    return true;
  }

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
    externalReads.clear();
    recoveryLoad += 1;
    buffers.clear();
    for (const timer of autoSaveTimers.values()) clearTimeout(timer);
    autoSaveTimers.clear();
    for (const timer of wordCountTimers.values()) clearTimeout(timer);
    wordCountTimers.clear();
    for (const timer of recoveryTimers.values()) clearTimeout(timer);
    recoveryTimers.clear();
    recoveries.value = [];
    recoveryError.value = '';
    conflictId.value = '';
    resolveUnsaved('cancel');
    tabs.value = [];
    activeId.value = '';
    newChapterOpen.value = false;
  }

  watch(
    () => [workspace.rootPath, workspace.revision],
    () => {
      reset();
      void loadRecoveries();
    },
    { flush: 'sync' }
  );
  onScopeDispose(() => {
    unregisterGuard();
    reset();
  });

  return {
    tabs,
    activeId,
    activeTab,
    searchRequest,
    location,
    locate,
    newChapterOpen,
    command,
    hasUnsaved,
    unsavedPrompt,
    recoveries,
    recoveryError,
    conflictId,
    conflictTab,
    loadRecoveries,
    restoreRecovery,
    discardRecovery,
    persistRecovery,
    handleWorkspaceChanged,
    acceptExternal,
    keepLocal,
    saveConflictCopy,
    autoSave,
    getBuffer: (id: string) => buffers.get(id),
    updateBuffer,
    saveDocument,
    saveAll,
    acceptDocumentChange,
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
    closeTabs,
    pathTabs,
    acceptPathRemoval,
    acceptPathMove,
    rememberView,
    requestSearch,
    reset
  };
});
