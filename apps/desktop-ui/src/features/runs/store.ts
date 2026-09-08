import { defineStore } from 'pinia';
import { onScopeDispose, ref, shallowRef, watch } from 'vue';

import type { AgentRunsListResult } from '@chaptale/ipc-contract';
import type { AgentRunRecord, AgentRunStatus, ReferencePack } from '@chaptale/shared';

import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { verifyRunOutput } from './presentation';

export const useRunStore = defineStore('run-history', () => {
  const workspace = useWorkspaceStore();
  const navigation = useWorkbenchStore();
  const records = shallowRef<AgentRunRecord[]>([]);
  const diagnostics = shallowRef<AgentRunsListResult['diagnostics']>([]);
  const query = ref('');
  const personaId = ref('__all');
  const status = ref<AgentRunStatus | '__all'>('__all');
  const nextCursor = ref<string>();
  const loading = ref(false);
  const error = ref('');
  const selected = shallowRef<AgentRunRecord | null>(null);
  const outputText = ref('');
  const outputError = ref('');
  const pack = shallowRef<ReferencePack | null>(null);
  const packError = ref('');
  const reading = ref(false);
  let epoch = 0;
  let loadSequence = 0;
  let readSequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function refresh(more = false) {
    const rootPath = workspace.rootPath;
    if (!rootPath || (more && (!nextCursor.value || loading.value))) return;
    const token = ++loadSequence;
    loading.value = true;
    try {
      const result = await getDesktopApi().tasks.listRuns({
        rootPath,
        limit: 50,
        query: query.value,
        ...(personaId.value === '__all' ? {} : { personaId: personaId.value }),
        ...(status.value === '__all' ? {} : { status: status.value }),
        ...(more ? { before: nextCursor.value } : {})
      });
      if (token !== loadSequence) return;
      records.value = more ? [...records.value, ...result.records] : result.records;
      diagnostics.value = result.diagnostics;
      nextCursor.value = result.nextCursor;
      error.value = '';
    } catch (cause) {
      if (token === loadSequence) error.value = toErrorMessage(cause);
    } finally {
      if (token === loadSequence) loading.value = false;
    }
  }
  async function select(record: AgentRunRecord) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const token = ++readSequence;
    selected.value = record;
    outputText.value = '';
    outputError.value = '';
    pack.value = null;
    packError.value = '';
    reading.value = true;
    await Promise.all([
      (async () => {
        if (!record.outputRef) return;
        try {
          const result = await getDesktopApi().tasks.readRunOutput(record.outputRef);
          if (token !== readSequence) return;
          verifyRunOutput(record, result);
          outputText.value = result!.kind === 'raw' ? result!.rawText : JSON.stringify(result!.output, null, 2);
        } catch (cause) {
          if (token === readSequence) outputError.value = toErrorMessage(cause);
        }
      })(),
      (async () => {
        if (!record.inputDigest.packId) return;
        try {
          const result = await getDesktopApi().library.readPack({ rootPath, packId: record.inputDigest.packId });
          if (token === readSequence) pack.value = result;
        } catch (cause) {
          if (token === readSequence) packError.value = toErrorMessage(cause);
        }
      })()
    ]);
    if (token === readSequence) reading.value = false;
  }
  async function open(runId: string) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const requestedEpoch = epoch;
    close();
    const token = readSequence;
    navigation.showAuxiliary('runs');
    try {
      const result = await getDesktopApi().tasks.listRuns({ rootPath, runId, limit: 1 });
      if (epoch !== requestedEpoch || token !== readSequence) return;
      if (!result.records.length) throw new Error('运行记录不存在或已损坏');
      await select(result.records[0]!);
      error.value = '';
    } catch (cause) {
      if (epoch === requestedEpoch) error.value = toErrorMessage(cause);
    }
  }
  function close() {
    ++readSequence;
    selected.value = null;
    reading.value = false;
    outputText.value = '';
    pack.value = null;
  }
  watch([query, personaId, status], () => {
    ++loadSequence;
    clearTimeout(timer);
    nextCursor.value = undefined;
    timer = setTimeout(() => void refresh(), 200);
  });
  watch(
    () => workspace.rootPath,
    () => {
      ++epoch;
      ++loadSequence;
      clearTimeout(timer);
      close();
      records.value = [];
      diagnostics.value = [];
      nextCursor.value = undefined;
      loading.value = false;
      error.value = '';
      void refresh();
    }
  );
  onScopeDispose(() => clearTimeout(timer));
  return {
    records,
    diagnostics,
    query,
    personaId,
    status,
    nextCursor,
    loading,
    error,
    selected,
    outputText,
    outputError,
    pack,
    packError,
    reading,
    refresh,
    select,
    open,
    close
  };
});
