import type { EditorState } from '@codemirror/state';
import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import type { EditorContext } from '@chaptale/agent-host/protocol';
import type { Document, ResourceAttributes, SaveDocumentInput } from '@chaptale/creation/contracts';
import { countDocumentWords } from '@chaptale/creation/text';

import { CreationRequestError, requestCreation, useCreationStore, useTrashStore } from '@/features/creation';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';
import { registerWorkspaceTransitionGuard } from '@/utils/workspace-transition';

import { useCheckStore } from './check/store';
import { DocumentBuffer } from './codemirror/document-buffer';
import { useHistoryStore } from './history/store';
import { reviewDone, useReviewStore } from './review/store';
import { writingTiming } from './timing';
import type { DocumentViewState, EditorTab } from './types';

function isDirty(tab: EditorTab, buffer: DocumentBuffer) {
  return (
    buffer.dirty ||
    tab.title !== tab.document!.title ||
    tab.format !== tab.document!.format ||
    JSON.stringify(tab.attributes) !== JSON.stringify(tab.document!.attributes)
  );
}

function snapshot(tab: EditorTab, buffer: DocumentBuffer): Omit<SaveDocumentInput, 'commandId'> {
  return {
    workId: tab.workId,
    documentId: tab.id,
    expectedRevisionId: tab.document!.revisionId,
    title: tab.title,
    format: tab.format,
    content: buffer.content,
    // 属性在入队时捕获为独立的 JSON 快照，后续编辑不影响在途请求。
    ...(tab.attributes && { attributes: JSON.parse(JSON.stringify(tab.attributes)) as ResourceAttributes })
  };
}

/** 每份文档的缓冲、基线修订与在途提交沿用稳定 ID；保存结束保留后续输入。 */
export const useEditorStore = defineStore('editor', () => {
  const creation = useCreationStore();
  const settings = useSettingsStore();
  const review = useReviewStore();
  const tabs = shallowRef<EditorTab[]>([]);
  const activeId = ref('');
  const focusedId = ref('');
  const searchRequest = ref(0);
  const command = shallowRef<{ name: 'undo' | 'redo'; sequence: number } | null>(null);
  /** discard 为 false 时只能保存或取消，用于需要正式稿的操作。 */
  const unsavedPrompt = shallowRef<{ titles: string[]; discard: boolean } | null>(null);
  const activeTab = computed(() => tabs.value.find(tab => tab.id === (focusedId.value || activeId.value)) ?? null);
  const hasUnsaved = computed(() => tabs.value.some(tab => tab.dirty || tab.saving));
  const autoSave = computed(() => settings.state?.settings.editor?.autoSave ?? false);
  const buffers = new Map<string, DocumentBuffer>();
  const queues = new Map<string, Promise<unknown>>();
  const saves = new Map<string, Promise<boolean>>();
  const attempts = new Map<string, { input: SaveDocumentInput; state: EditorState }>();
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let decision:
    | { promise: Promise<'save' | 'discard' | 'cancel'>; resolve: (value: 'save' | 'discard' | 'cancel') => void }
    | undefined;
  let closing: Promise<void> | undefined;
  let closingApproved = false;

  function clearTimers(id: string) {
    clearTimeout(recoveryTimers.get(id));
    clearTimeout(saveTimers.get(id));
  }
  function clearAllTimers() {
    for (const timer of recoveryTimers.values()) clearTimeout(timer);
    for (const timer of saveTimers.values()) clearTimeout(timer);
  }
  /** 标签回到给定的正式稿：丢弃本地输入与未完成的保存尝试，编辑器按新代次重建。 */
  function resetToDocument(id: string, document: Document) {
    const tab = find(id)!;
    attempts.delete(id);
    buffers.set(id, new DocumentBuffer(document.content));
    patch(id, {
      document,
      title: document.title,
      format: document.format,
      attributes: document.attributes,
      dirty: false,
      conflict: null,
      saveError: '',
      words: document.wordCount,
      generation: tab.generation + 1
    });
  }
  function patch(id: string, fields: Partial<EditorTab>) {
    tabs.value = tabs.value.map(tab => (tab.id === id ? { ...tab, ...fields } : tab));
  }
  function find(id: string) {
    return tabs.value.find(tab => tab.id === id);
  }
  function queue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    queues.set(id, next);
    void next.then(
      () => {
        if (queues.get(id) === next) queues.delete(id);
      },
      () => {
        if (queues.get(id) === next) queues.delete(id);
      }
    );
    return next;
  }
  function updateBuffer(id: string, buffer: DocumentBuffer) {
    const tab = find(id);
    if (!tab?.document) return;
    buffers.set(id, buffer);
    patch(id, { dirty: isDirty(tab, buffer), words: countDocumentWords(buffer.content) });
    schedule(id);
  }
  function updateMetadata(
    id: string,
    fields: { title?: string; format?: Document['format']; attributes?: ResourceAttributes }
  ) {
    patch(id, fields);
    const buffer = buffers.get(id);
    if (buffer) updateBuffer(id, buffer);
  }
  function schedule(id: string) {
    clearTimeout(recoveryTimers.get(id));
    recoveryTimers.set(
      id,
      setTimeout(() => {
        void persistRecovery(id);
      }, writingTiming.recoveryDelayMs)
    );
    clearTimeout(saveTimers.get(id));
    const tab = find(id)!;
    if (autoSave.value && tab.dirty && !tab.saveError && !tab.conflict)
      saveTimers.set(
        id,
        setTimeout(() => {
          void saveDocument(id);
        }, writingTiming.autoSaveDelayMs)
      );
  }

  async function openDocument(id: string, reveal = true) {
    if (reveal) useWorkbenchStore().focusEditor();
    useTrashStore().preview = null;
    if (find(id)) {
      selectTab(id);
      return;
    }
    const workId = creation.workId!;
    const entry = creation.entries.find(item => item.id === id);
    if (!entry || entry.kind !== 'document') return;
    tabs.value = [
      ...tabs.value,
      {
        id,
        workId,
        title: entry.title,
        format: entry.format!,
        attributes: null,
        document: null,
        status: 'loading',
        error: '',
        dirty: false,
        saving: false,
        saveError: '',
        recoveryError: '',
        draftVersion: null,
        recovery: null,
        conflict: null,
        words: entry.wordCount,
        generation: 0
      }
    ];
    const state = creation.viewFor(workId);
    if (!state.tabs.some(tab => tab.documentId === id))
      state.tabs.push({ documentId: id, anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0 });
    selectTab(id);
    await load(id);
  }
  async function load(id: string) {
    const tab = find(id)!;
    try {
      const document = await requestCreation('readDocument', { workId: tab.workId, documentId: id });
      const draft = await requestCreation('readDraftState', { workId: tab.workId, documentId: id });
      if (creation.workId !== tab.workId || !find(id) || find(id)!.dirty) return;
      buffers.set(id, new DocumentBuffer(document.content));
      patch(id, {
        document,
        title: document.title,
        format: document.format,
        attributes: document.attributes,
        status: 'ready',
        error: '',
        draftVersion: draft.version,
        recovery: draft.draft,
        words: document.wordCount,
        generation: (find(id)?.generation ?? 0) + 1,
        conflict: null,
        saveError: ''
      });
    } catch (cause) {
      if (find(id)?.workId === tab.workId) patch(id, { status: 'error', error: toErrorMessage(cause) });
    }
  }
  function selectTab(id: string) {
    const tab = find(id);
    if (!tab) return;
    const state = creation.viewFor(tab.workId);
    if (state.secondaryDocumentId === id) state.secondaryDocumentId = activeId.value || null;
    review.activeId = '';
    useHistoryStore().activeId = '';
    useCheckStore().activeId = '';
    useTrashStore().preview = null;
    activeId.value = id;
    focusedId.value = id;
    state.activeDocumentId = id;
  }
  function rememberView(workId: string, id: string, state: DocumentViewState) {
    const position = creation.viewFor(workId).tabs.find(tab => tab.documentId === id);
    if (position) Object.assign(position, state);
  }
  function viewState(tab: EditorTab) {
    return creation.viewFor(tab.workId).tabs.find(item => item.documentId === tab.id);
  }

  async function writeRecovery(id: string, input: Omit<SaveDocumentInput, 'commandId'>, draftId: string) {
    const result = await requestCreation('writeDraft', {
      ...input,
      draftId,
      expectedDraftVersion: find(id)!.draftVersion
    });
    patch(id, { draftVersion: result.version, recoveryError: '' });
  }
  function persistRecovery(id: string): Promise<boolean> {
    clearTimeout(recoveryTimers.get(id));
    return queue(id, async () => {
      const tab = find(id);
      const buffer = buffers.get(id);
      if (!tab?.document || !buffer || tab.recovery || attempts.has(id)) return true;
      try {
        if (tab.dirty) await writeRecovery(id, snapshot(tab, buffer), crypto.randomUUID());
        else if (tab.draftVersion) await discardRecoveryNow(tab);
        return true;
      } catch (cause) {
        patch(id, { recoveryError: `恢复草稿保存失败：${toErrorMessage(cause)}` });
        return false;
      }
    });
  }
  async function discardRecoveryNow(tab: EditorTab) {
    if (tab.draftVersion) {
      const result = await requestCreation('discardDraft', {
        workId: tab.workId,
        documentId: tab.id,
        draftId: tab.draftVersion
      });
      patch(tab.id, { draftVersion: result.version, recovery: null, recoveryError: '' });
    }
  }
  async function discardRecovery(id: string) {
    try {
      await queue(id, () => discardRecoveryNow(find(id)!));
    } catch (cause) {
      patch(id, { recoveryError: toErrorMessage(cause) });
    }
  }
  function restoreRecovery(id: string) {
    const tab = find(id)!;
    const draft = tab.recovery!;
    const buffer = buffers.get(id)!;
    buffer.replaceContent(draft.content, true);
    patch(id, {
      title: draft.title,
      format: draft.format,
      attributes: draft.attributes ?? tab.attributes,
      recovery: null,
      document: { ...tab.document!, revisionId: draft.expectedRevisionId }
    });
    updateBuffer(id, buffer);
  }

  function saveDocument(id = focusedId.value || activeId.value): Promise<boolean> {
    const running = saves.get(id);
    if (running) return running;
    clearTimers(id);
    const save = queue(id, async () => {
      const tab = find(id);
      const buffer = buffers.get(id);
      if (!tab?.document || !buffer || !tab.dirty) return true;
      if (tab.recovery) {
        patch(id, { saveError: '请先恢复或放弃上次未保存的草稿' });
        return false;
      }
      patch(id, { saving: true, saveError: '' });
      try {
        let attempt = attempts.get(id);
        if (!attempt) {
          const input = { ...snapshot(tab, buffer), commandId: crypto.randomUUID() };
          attempt = { input, state: buffer.prepareSave() };
          const { commandId, ...draftInput } = input;
          await writeRecovery(id, draftInput, commandId);
          attempts.set(id, attempt);
        }
        const saved = await requestCreation('saveDocument', attempt.input);
        attempts.delete(id);
        buffer.markSaved(attempt.state);
        const current = find(id)!;
        const document = {
          ...saved,
          kind: 'document' as const,
          format: attempt.input.format,
          content: attempt.input.content,
          attributes: attempt.input.attributes ?? current.document!.attributes
        };
        patch(id, {
          document,
          dirty: isDirty({ ...current, document }, buffer),
          conflict: null,
          saving: false,
          saveError: ''
        });
        await creation.refreshEntries();
        return !find(id)!.dirty;
      } catch (cause) {
        patch(id, { saving: false, saveError: toErrorMessage(cause) });
        if (cause instanceof CreationRequestError && cause.detail.code === 'revision-conflict') {
          attempts.delete(id);
          try {
            patch(id, { conflict: await requestCreation('readDocument', { workId: tab.workId, documentId: id }) });
          } catch (readError) {
            patch(id, { saveError: toErrorMessage(readError) });
          }
        }
        return false;
      }
    });
    saves.set(id, save);
    void save.finally(() => {
      saves.delete(id);
      if (find(id)?.dirty && !attempts.has(id)) void persistRecovery(id);
    });
    return save;
  }
  async function saveAll() {
    for (const tab of tabs.value) if (!(await saveDocument(tab.id))) return false;
    return !hasUnsaved.value;
  }
  async function keepLocal(id: string) {
    const tab = find(id)!;
    if (!tab.conflict) return;
    patch(id, { document: tab.conflict, conflict: null, saveError: '' });
    await saveDocument(id);
  }
  async function acceptSaved(id: string) {
    const tab = find(id)!;
    if (!tab.conflict) return;
    await queue(id, () => discardRecoveryNow(tab));
    resetToDocument(id, tab.conflict);
  }

  async function promptUnsaved(titles: string[], discard = true): Promise<'save' | 'discard' | 'cancel'> {
    if (!decision) {
      let resolve!: (choice: 'save' | 'discard' | 'cancel') => void;
      const promise = new Promise<'save' | 'discard' | 'cancel'>(done => {
        resolve = done;
      });
      decision = { promise, resolve };
      unsavedPrompt.value = { titles, discard };
    }
    return decision.promise;
  }

  async function confirmClose(ids = tabs.value.map(tab => tab.id), discard = true): Promise<boolean> {
    await Promise.all(ids.map(id => saves.get(id)));
    const dirty = tabs.value.filter(tab => ids.includes(tab.id) && tab.dirty);
    if (!dirty.length) return true;
    const choice = await promptUnsaved(
      dirty.map(tab => tab.title),
      discard
    );
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      for (const tab of dirty) if (!(await saveDocument(tab.id))) return false;
    } else {
      for (const tab of dirty) {
        clearTimers(tab.id);
        try {
          await queue(tab.id, () => discardRecoveryNow(find(tab.id)!));
        } catch (cause) {
          patch(tab.id, { recoveryError: toErrorMessage(cause) });
          return false;
        }
        resetToDocument(tab.id, find(tab.id)!.document!);
      }
    }
    return !tabs.value.some(tab => ids.includes(tab.id) && tab.dirty);
  }
  function resolveUnsaved(choice: 'save' | 'discard' | 'cancel') {
    decision?.resolve(choice);
    decision = undefined;
    unsavedPrompt.value = null;
  }
  /** 从章节提取事件读取正式稿；打开的章节有未保存修改时先询问保存。 */
  async function extractChapter(chapter: { id: string; title: string }) {
    if (find(chapter.id) && !(await confirmClose([chapter.id], false))) return;
    await useWorkbenchStore().extractChapter(chapter);
  }
  function quoteToChat(context: EditorContext) {
    useWorkbenchStore().quoteToChat(JSON.parse(JSON.stringify(context)) as EditorContext);
  }
  async function closeTab(id: string) {
    if (!(await confirmClose([id]))) return;
    await queues.get(id);
    const tab = find(id)!;
    const state = creation.viewFor(tab.workId);
    state.tabs = state.tabs.filter(item => item.documentId !== id);
    if (state.secondaryDocumentId === id) state.secondaryDocumentId = null;
    buffers.delete(id);
    if (focusedId.value === id) focusedId.value = '';
    clearTimers(id);
    tabs.value = tabs.value.filter(item => item.id !== id);
    if (activeId.value === id) {
      activeId.value = tabs.value.at(-1)?.id ?? '';
      state.activeDocumentId = activeId.value || null;
    }
  }
  function requestCommand(name: 'undo' | 'redo') {
    command.value = { name, sequence: (command.value?.sequence ?? 0) + 1 };
  }
  function requestSearch() {
    searchRequest.value += 1;
  }
  async function setAutoSave(value: boolean) {
    await settings.update({ editor: { autoSave: value } });
    if (value) await saveAll();
  }
  async function prepareSwitch() {
    if (!review.confirmLeave()) return false;
    if (!(await confirmClose())) return false;
    await Promise.all(queues.values());
    return creation.persistState();
  }
  const unregister = registerWorkspaceTransitionGuard(prepareSwitch);
  function requestWindowClose(): Promise<void> {
    void getDesktopApi().windowControl.completeClose(false);
    closing ??= (async () => {
      if (!(await prepareSwitch())) return;
      closingApproved = true;
      try {
        await getDesktopApi().windowControl.completeClose(true);
      } catch (cause) {
        closingApproved = false;
        throw cause;
      }
    })().finally(() => {
      closing = undefined;
    });
    return closing;
  }
  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if ((hasUnsaved.value || review.hasUnsaved) && !closingApproved) {
      event.preventDefault();
    }
  }

  watch(
    () => creation.workId,
    async id => {
      clearAllTimers();
      tabs.value = [];
      activeId.value = '';
      focusedId.value = '';
      buffers.clear();
      attempts.clear();
      if (!id) return;
      const state = creation.viewFor(id);
      const selected = state.activeDocumentId;
      const documentIds = state.tabs.map(tab => tab.documentId);
      for (const documentId of documentIds) {
        if (creation.workId !== id) return;
        await openDocument(documentId, false);
      }
      if (selected && find(selected)) selectTab(selected);
    },
    { flush: 'post' }
  );
  watch(
    () => creation.entries,
    () => {
      for (const tab of tabs.value) {
        const entry = creation.entries.find(item => item.id === tab.id);
        if (entry && tab.document && entry.revisionId !== tab.document.revisionId && !tab.dirty && !tab.saving)
          void load(tab.id);
      }
    }
  );
  // 处理完的资料标签与同一资料的文稿标签重复，留文稿标签。
  watch(
    () =>
      review.tabs
        .filter(tab => reviewDone(tab) && tabs.value.some(item => item.id === tab.entryId))
        .map(tab => tab.key),
    keys => {
      for (const key of keys) {
        const entryId = review.tabs.find(tab => tab.key === key)!.entryId;
        const active = review.activeId === key;
        review.close(key);
        if (active) selectTab(entryId);
      }
    }
  );
  onScopeDispose(() => {
    unregister();
    clearAllTimers();
  });

  return {
    tabs,
    activeId,
    focusedId,
    activeTab,
    hasUnsaved,
    autoSave,
    searchRequest,
    command,
    unsavedPrompt,
    extractChapter,
    quoteToChat,
    getBuffer: (id: string) => buffers.get(id),
    updateBuffer,
    updateMetadata,
    openDocument,
    selectTab,
    reloadDocument: load,
    rememberView,
    viewState,
    persistRecovery,
    restoreRecovery,
    discardRecovery,
    saveDocument,
    saveAll,
    keepLocal,
    acceptSaved,
    promptUnsaved,
    confirmClose,
    resolveUnsaved,
    closeTab,
    requestCommand,
    requestSearch,
    setAutoSave,
    requestWindowClose,
    handleBeforeUnload
  };
});
