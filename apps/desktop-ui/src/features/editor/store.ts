import { EditorSelection, type EditorState } from '@codemirror/state';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';

import type { EditorContext } from '@chaptale/agent-host/protocol';
import type { EditorGroupIndex, EditorGroupState } from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore, useTrashStore } from '@/features/creation';
import { useSettingsStore } from '@/features/settings';
import { toErrorMessage } from '@/utils/desktop-api';

import { useCheckStore } from './check/store';
import { useCloseFlow } from './closing';
import { DocumentBuffer } from './codemirror/document-buffer';
import { createOpenDocuments } from './documents';
import {
  activateTabInGroup,
  allOpenDocumentIds,
  closeTabInGroup,
  countDocumentOccurrences,
  createEmptyGroups,
  openTabInSideGroup,
  splitTabToRightGroup
} from './groups';
import { useHistoryStore } from './history/store';
import { useReadingStore } from './reading/store';
import { reviewDone, useReviewStore } from './review/store';
import { useDocumentSaving } from './saving';
import type { DocumentViewState, EditorTab } from './types';

/** 编辑器里发起、由对话完成的操作；对话在编辑器上层，由工作台布局接入。 */
interface EditorChat {
  extractChapter(chapter: { id: string; title: string }): Promise<void>;
  quoteToChat(context: EditorContext): void;
}

/** 编辑器的标签与分栏；保存与恢复见 saving.ts，离开前的确认见 closing.ts。 */
export const useEditorStore = defineStore('editor', () => {
  const creation = useCreationStore();
  const settings = useSettingsStore();
  const review = useReviewStore();
  const documents = createOpenDocuments();
  const { tabs, buffers, find, patch, bumpBufferVersion } = documents;
  const specialGroup = ref<EditorGroupIndex>(0);
  const searchRequest = ref(0);
  const command = shallowRef<{ name: 'undo' | 'redo'; sequence: number } | null>(null);
  const groups = computed<readonly EditorGroupState[]>(() => creation.view?.groups ?? createEmptyGroups());
  const activeGroup = computed<EditorGroupIndex>(() => {
    const current = creation.view;
    if (!current) return 0;
    return current.activeGroup < current.groups.length ? current.activeGroup : 0;
  });
  function isSpecialActiveInGroup(groupIndex: EditorGroupIndex): boolean {
    const currentGroup: EditorGroupIndex = groups.value.length === 1 ? 0 : specialGroup.value;
    return (
      currentGroup === groupIndex &&
      Boolean(review.activeTab || useHistoryStore().activeTab || useCheckStore().activeTab)
    );
  }
  const activeId = computed(() =>
    isSpecialActiveInGroup(activeGroup.value) ? '' : (groups.value[activeGroup.value]?.activeDocumentId ?? '')
  );
  const activeTab = computed(() =>
    activeId.value ? (tabs.value.find(tab => tab.id === activeId.value) ?? null) : null
  );
  const autoSave = computed(() => settings.state?.settings.editor?.autoSave ?? false);
  const saving = useDocumentSaving(documents, autoSave);
  const closeFlow = useCloseFlow(documents, saving);
  const mountedStates = new Map<string, () => EditorState>();

  function ensureTabRecord(id: string): boolean {
    if (find(id)) return true;
    const workId = creation.workId!;
    const entry = creation.entries.find(item => item.id === id);
    if (!entry || entry.kind !== 'document') return false;
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
    return true;
  }

  async function openDocument(id: string, groupIndex: EditorGroupIndex = activeGroup.value) {
    useTrashStore().preview = null;
    const alreadyLoaded = Boolean(find(id));
    if (!ensureTabRecord(id)) return;
    const state = creation.viewFor(creation.workId!);
    activateTabInGroup(state, groupIndex, id);
    clearSpecialTabsForGroup(state.activeGroup);
    if (!alreadyLoaded) await load(id);
  }

  async function openToSide(id: string) {
    useTrashStore().preview = null;
    const alreadyLoaded = Boolean(find(id));
    if (!ensureTabRecord(id)) return;
    const state = creation.viewFor(creation.workId!);
    openTabInSideGroup(state, id);
    clearSpecialTabsForGroup(state.activeGroup);
    if (!alreadyLoaded) await load(id);
  }

  function splitRight(id = activeId.value, sourceGroup: EditorGroupIndex = activeGroup.value) {
    if (!id || !find(id) || !creation.workId) return;
    useTrashStore().preview = null;
    const state = creation.viewFor(creation.workId);
    splitTabToRightGroup(state, id, sourceGroup);
    clearSpecialTabsForGroup(1);
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
      bumpBufferVersion(id);
    } catch (cause) {
      if (find(id)?.workId === tab.workId) patch(id, { status: 'error', error: toErrorMessage(cause) });
    }
  }

  function clearSpecialTabsForGroup(groupIndex: EditorGroupIndex) {
    const owner: EditorGroupIndex = groups.value.length === 1 ? 0 : specialGroup.value;
    if (owner !== groupIndex) return;
    review.activeId = '';
    useHistoryStore().activeId = '';
    useCheckStore().activeId = '';
  }

  function focusGroup(groupIndex: EditorGroupIndex) {
    if (!creation.view || !creation.view.groups[groupIndex]) return;
    creation.view.activeGroup = groupIndex;
  }

  function selectTab(id: string, groupIndex: EditorGroupIndex = activeGroup.value) {
    const tab = find(id);
    if (!tab) return;
    const state = creation.viewFor(tab.workId);
    activateTabInGroup(state, groupIndex, id);
    clearSpecialTabsForGroup(state.activeGroup);
    useTrashStore().preview = null;
  }

  function rememberView(workId: string, id: string, state: DocumentViewState, groupIndex: EditorGroupIndex = 0) {
    const group = creation.viewFor(workId).groups[groupIndex];
    const position = group?.tabs.find(tab => tab.documentId === id);
    if (position) Object.assign(position, state);
  }

  function viewState(tab: EditorTab, groupIndex: EditorGroupIndex = activeGroup.value) {
    const view = creation.viewFor(tab.workId);
    const group = view.groups[groupIndex] ?? view.groups[0];
    return group?.tabs.find(item => item.documentId === tab.id);
  }

  function registerMountedState(groupIndex: EditorGroupIndex, documentId: string, getter: (() => EditorState) | null) {
    const key = `${groupIndex}:${documentId}`;
    if (getter) mountedStates.set(key, getter);
    else mountedStates.delete(key);
  }

  function selectionState(
    documentId: string,
    groupIndex: EditorGroupIndex = activeGroup.value
  ): EditorState | undefined {
    const live = mountedStates.get(`${groupIndex}:${documentId}`);
    if (live) return live();
    const buffer = buffers.get(documentId);
    const tab = find(documentId);
    if (!buffer || !tab) return buffer?.state;
    const pos = viewState(tab, groupIndex);
    if (!pos || (pos.anchor === 0 && pos.head === 0)) return buffer.state;
    const length = buffer.state.doc.length;
    return buffer.state.update({
      selection: EditorSelection.single(Math.min(pos.anchor, length), Math.min(pos.head, length))
    }).state;
  }

  let chat: EditorChat | undefined;
  function setChat(value: EditorChat | undefined) {
    chat = value;
  }
  /** 从章节提取事件读取正式稿；打开的章节有未保存修改时先询问保存。 */
  async function extractChapter(chapter: { id: string; title: string }) {
    if (find(chapter.id) && !(await closeFlow.confirmClose([chapter.id], false))) return;
    await chat!.extractChapter(chapter);
  }
  function quoteToChat(context: EditorContext) {
    chat!.quoteToChat(JSON.parse(JSON.stringify(context)) as EditorContext);
  }
  async function closeTab(id: string, groupIndex?: EditorGroupIndex) {
    const tab = find(id);
    if (!tab) return;
    const state = creation.viewFor(tab.workId);
    const closingAll = groupIndex === undefined;
    const occurrences = countDocumentOccurrences(state, id);
    const willUnload = closingAll || occurrences <= 1;
    if (willUnload && !(await closeFlow.confirmClose([id]))) return;
    if (willUnload) await saving.settled(id);

    if (closingAll) {
      for (let idx = state.groups.length - 1; idx >= 0; idx -= 1) {
        if (state.groups[idx]?.tabs.some(item => item.documentId === id)) {
          const result = closeTabInGroup(state, idx as EditorGroupIndex, id);
          if (result.keptGroupAfterCollapse !== undefined) {
            useReadingStore().onGroupCollapsed(result.keptGroupAfterCollapse);
            specialGroup.value = 0;
          }
        }
      }
    } else {
      const result = closeTabInGroup(state, groupIndex, id);
      if (result.keptGroupAfterCollapse !== undefined) {
        useReadingStore().onGroupCollapsed(result.keptGroupAfterCollapse);
        specialGroup.value = 0;
      }
    }

    if (countDocumentOccurrences(state, id) === 0) {
      buffers.delete(id);
      mountedStates.delete(`0:${id}`);
      mountedStates.delete(`1:${id}`);
      saving.clearTimers(id);
      tabs.value = tabs.value.filter(item => item.id !== id);
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
    if (value) await saving.saveAll();
  }

  watch(
    () => [review.activeId, useHistoryStore().activeId, useCheckStore().activeId] as const,
    ([reviewId, historyId, checkId], [prevReview, prevHistory, prevCheck]) => {
      const activated =
        (reviewId && reviewId !== prevReview) ||
        (historyId && historyId !== prevHistory) ||
        (checkId && checkId !== prevCheck);
      if (activated) specialGroup.value = activeGroup.value;
    }
  );

  watch(
    () => creation.workId,
    async id => {
      saving.reset();
      tabs.value = [];
      specialGroup.value = 0;
      buffers.clear();
      mountedStates.clear();
      if (!id) return;
      const state = creation.viewFor(id);
      const documentIds = allOpenDocumentIds(state);
      for (const documentId of documentIds) {
        if (creation.workId !== id) return;
        if (ensureTabRecord(documentId)) await load(documentId);
      }
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

  return {
    tabs,
    groups,
    activeGroup,
    specialGroup,
    bufferVersions: documents.bufferVersions,
    activeId,
    activeTab,
    hasUnsaved: saving.hasUnsaved,
    autoSave,
    searchRequest,
    command,
    unsavedPrompt: closeFlow.unsavedPrompt,
    isSpecialActiveInGroup,
    focusGroup,
    setChat,
    extractChapter,
    quoteToChat,
    getBuffer: (id: string) => buffers.get(id),
    registerMountedState,
    selectionState,
    updateBuffer: saving.updateBuffer,
    updateMetadata: saving.updateMetadata,
    openDocument,
    openToSide,
    splitRight,
    selectTab,
    reloadDocument: load,
    rememberView,
    viewState,
    persistRecovery: saving.persistRecovery,
    restoreRecovery: saving.restoreRecovery,
    discardRecovery: saving.discardRecovery,
    saveDocument: (id = activeId.value) => saving.saveDocument(id),
    saveAll: saving.saveAll,
    keepLocal: saving.keepLocal,
    acceptSaved: saving.acceptSaved,
    promptUnsaved: closeFlow.promptUnsaved,
    confirmClose: closeFlow.confirmClose,
    resolveUnsaved: closeFlow.resolveUnsaved,
    closeTab,
    requestCommand,
    requestSearch,
    setAutoSave,
    requestWindowClose: closeFlow.requestWindowClose,
    handleBeforeUnload: closeFlow.handleBeforeUnload
  };
});
