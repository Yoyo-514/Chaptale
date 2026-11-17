import type { EditorState } from '@codemirror/state';
import { computed, onScopeDispose, type Ref } from 'vue';

import type { Document, ResourceAttributes, SaveDocumentInput } from '@chaptale/creation/contracts';
import { countDocumentWords } from '@chaptale/creation/text';

import { CreationRequestError, requestCreation, useCreationStore } from '@/features/creation';
import { toErrorMessage } from '@/utils/desktop-api';

import { DocumentBuffer } from './codemirror/document-buffer';
import type { OpenDocuments } from './documents';
import { writingTiming } from './timing';
import type { EditorTab } from './types';

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

/** 保存与恢复草稿：每份文稿的写入按顺序排队，保存结束后保留请求期间的后续输入。 */
export function useDocumentSaving(documents: OpenDocuments, autoSave: Readonly<Ref<boolean>>) {
  const creation = useCreationStore();
  const { tabs, buffers, find, patch, bumpBufferVersion } = documents;
  const hasUnsaved = computed(() => tabs.value.some(tab => tab.dirty || tab.saving));
  const queues = new Map<string, Promise<unknown>>();
  const saves = new Map<string, Promise<boolean>>();
  const attempts = new Map<string, { input: SaveDocumentInput; state: EditorState }>();
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    bumpBufferVersion(id);
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

  function saveDocument(id: string): Promise<boolean> {
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
  /** 放弃未保存修改：清掉恢复草稿并回到正式稿；草稿清理失败时保留现状。 */
  async function discardChanges(id: string): Promise<boolean> {
    clearTimers(id);
    try {
      await queue(id, () => discardRecoveryNow(find(id)!));
    } catch (cause) {
      patch(id, { recoveryError: toErrorMessage(cause) });
      return false;
    }
    resetToDocument(id, find(id)!.document!);
    return true;
  }
  /** 切换作品时丢弃全部计时与未完成的保存尝试。 */
  function reset() {
    clearAllTimers();
    attempts.clear();
  }
  onScopeDispose(clearAllTimers);

  return {
    hasUnsaved,
    updateBuffer,
    updateMetadata,
    persistRecovery,
    restoreRecovery,
    discardRecovery,
    saveDocument,
    saveAll,
    keepLocal,
    acceptSaved,
    discardChanges,
    clearTimers,
    reset,
    /** 这份文稿正在进行的保存。 */
    pendingSave: (id: string) => saves.get(id),
    /** 这份文稿排队中的写入；不传 ID 时等全部文稿。 */
    settled: (id?: string) => (id ? queues.get(id) : Promise.all(queues.values()))
  };
}

export type DocumentSaving = ReturnType<typeof useDocumentSaving>;
