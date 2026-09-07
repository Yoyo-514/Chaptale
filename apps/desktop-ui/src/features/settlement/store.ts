import { defineStore } from 'pinia';
import { ref, shallowRef, toRaw, watch } from 'vue';

import type { ChaptaleModelInfo, StartSettlementArgs } from '@chaptale/ipc-contract';
import type { SettlementDetails, SettlementPlan, SettlementSummary } from '@chaptale/shared';

import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const useSettlementStore = defineStore('chapter-settlement', () => {
  const workspace = useWorkspaceStore();
  const editor = useEditorStore();
  const library = useLibraryStore();
  const navigation = useWorkbenchStore();
  const batches = shallowRef<SettlementSummary[]>([]);
  const details = shallowRef<SettlementDetails | null>(null);
  const confirmation = ref<{ plan: SettlementPlan; request: StartSettlementArgs } | null>(null);
  const models = shallowRef<ChaptaleModelInfo[]>([]);
  const running = ref<Array<{ id: string; chapterPath: string }>>([]);
  const diagnostics = ref<string[]>([]);
  const error = ref('');
  const busy = ref(false);
  let sequence = 0;
  let readSequence = 0;

  function assertClean(paths: string[]) {
    const dirty = editor.tabs.find(tab => paths.includes(tab.path) && (tab.dirty || tab.saving || tab.external));
    if (dirty) throw new Error(`请先保存或处理外部变化：${dirty.path}`);
  }
  async function refresh() {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const token = ++sequence;
    try {
      const result = await getDesktopApi().settlement.list({ rootPath });
      if (token !== sequence || rootPath !== workspace.rootPath) return;
      batches.value = result.batches;
      diagnostics.value = result.diagnostics;
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    }
  }
  async function read(batchId: string) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const token = ++readSequence;
    try {
      const result = await getDesktopApi().settlement.read({ rootPath, batchId });
      if (token !== readSequence || rootPath !== workspace.rootPath) return;
      details.value = result;
      error.value = '';
      navigation.auxiliary = 'settlement';
    } catch (cause) {
      if (token === readSequence) error.value = toErrorMessage(cause);
    }
  }
  async function prepare(chapterPath?: string) {
    navigation.auxiliary = 'settlement';
    if (busy.value) return;
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    busy.value = true;
    error.value = '';
    try {
      if (chapterPath) await editor.openDocument(chapterPath);
      const tab = editor.activeTab;
      if (!tab?.document || tab.readonly) throw new Error('请打开已保存的章节正文');
      assertClean([tab.path]);
      const pack = await getDesktopApi().library.freezePack({
        rootPath,
        goal: `结算本章已发生事实：${tab.path}`,
        budgetChars: library.budgetChars,
        selections: library.selections.map(selection => ({ ...selection }))
      });
      const plan = await getDesktopApi().settlement.prepare({ rootPath, chapterPath: tab.path, packId: pack.id });
      assertClean([plan.chapterPath, ...plan.scenePaths, ...plan.sources]);
      const available = await getDesktopApi().models.list();
      if (rootPath !== workspace.rootPath) return;
      models.value = available.models.filter(model => model.authConfigured);
      const model = models.value.find(value => value.isDefault) ?? models.value[0];
      confirmation.value = {
        plan,
        request: {
          rootPath,
          chapterPath: plan.chapterPath,
          packId: plan.packId,
          expectedHash: plan.expectedHash,
          batchId: crypto.randomUUID(),
          autoAcceptSummary: false,
          model: { provider: model?.provider ?? '', modelId: model?.id ?? '' }
        }
      };
      details.value = null;
    } catch (cause) {
      if (rootPath === workspace.rootPath) error.value = toErrorMessage(cause);
    } finally {
      if (rootPath === workspace.rootPath) busy.value = false;
    }
  }
  async function start() {
    if (!confirmation.value) return;
    const { plan } = confirmation.value;
    const request = structuredClone(toRaw(confirmation.value.request));
    try {
      assertClean([plan.chapterPath, ...plan.scenePaths, ...plan.sources]);
    } catch (cause) {
      error.value = toErrorMessage(cause);
      return;
    }
    confirmation.value = null;
    running.value.push({ id: request.batchId, chapterPath: request.chapterPath });
    try {
      const result = await getDesktopApi().settlement.start(request);
      if (rootPathMatches(request.rootPath)) details.value = result;
    } catch (cause) {
      if (rootPathMatches(request.rootPath)) error.value = toErrorMessage(cause);
    } finally {
      if (rootPathMatches(request.rootPath)) {
        running.value = running.value.filter(value => value.id !== request.batchId);
        await refresh();
      }
    }
  }
  const rootPathMatches = (rootPath: string) => rootPath === workspace.rootPath;
  async function cancel(batchId: string) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    try {
      await getDesktopApi().settlement.cancel({ rootPath, batchId });
    } catch (cause) {
      if (rootPathMatches(rootPath)) error.value = toErrorMessage(cause);
    }
  }
  async function resolve(itemId: string, action: 'accept' | 'reject', editedContent?: string) {
    const batch = details.value?.batch;
    const item = batch?.items.find(value => value.id === itemId);
    const rootPath = workspace.rootPath;
    if (!batch || !item || !rootPath || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      if (action === 'accept') assertClean([batch.chapterPath, item.targetPath]);
      const args = {
        rootPath,
        batchId: batch.id,
        itemId,
        action,
        revision: batch.revision,
        ...(editedContent !== undefined ? { editedContent } : {})
      };
      let result: SettlementDetails;
      if (action === 'accept' && item.baseline && !item.applying && item.category !== 'summary') {
        const accepted = await editor.acceptDocumentChange(item.targetPath, item.baseline.contentHash, async () => {
          const resolved = await getDesktopApi().settlement.resolve(args);
          const documentResult = await getDesktopApi().workspace.readDocument({
            rootPath,
            relativePath: item.targetPath
          });
          if (!documentResult.ok) throw new Error(documentResult.message);
          return { document: documentResult.document, resolved };
        });
        result = accepted.resolved;
      } else result = await getDesktopApi().settlement.resolve(args);
      if (rootPathMatches(rootPath)) {
        details.value = result;
        await library.load();
      }
    } catch (cause) {
      if (rootPathMatches(rootPath)) {
        await read(batch.id);
        error.value = toErrorMessage(cause);
      }
    } finally {
      if (rootPathMatches(rootPath)) {
        busy.value = false;
        await refresh();
      }
    }
  }
  async function complete() {
    const batch = details.value?.batch;
    const rootPath = workspace.rootPath;
    if (!batch || !rootPath || busy.value) return;
    busy.value = true;
    try {
      assertClean([batch.chapterPath, ...batch.scenes.map(scene => scene.sourcePath)]);
      const result = await getDesktopApi().settlement.complete({
        rootPath,
        batchId: batch.id,
        revision: batch.revision
      });
      if (rootPathMatches(rootPath)) {
        details.value = result;
        error.value = '';
        await library.load();
      }
    } catch (cause) {
      if (rootPathMatches(rootPath)) {
        await read(batch.id);
        error.value = toErrorMessage(cause);
      }
    } finally {
      if (rootPathMatches(rootPath)) {
        busy.value = false;
        await refresh();
      }
    }
  }
  watch(
    () => workspace.rootPath,
    () => {
      ++sequence;
      ++readSequence;
      batches.value = [];
      details.value = null;
      confirmation.value = null;
      models.value = [];
      running.value = [];
      diagnostics.value = [];
      error.value = '';
      busy.value = false;
    }
  );
  return {
    batches,
    details,
    confirmation,
    models,
    running,
    diagnostics,
    error,
    busy,
    refresh,
    read,
    prepare,
    start,
    cancel,
    resolve,
    complete
  };
});
