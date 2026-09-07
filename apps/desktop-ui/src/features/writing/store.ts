import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';

import type { ChaptaleModelInfo, DraftRequest, RewritePlan, RewriteSelection } from '@chaptale/ipc-contract';
import {
  normalizeDocumentText,
  type CandidateDetails,
  type CandidateSummary,
  type WritingModel
} from '@chaptale/shared';

import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const useWritingStore = defineStore('writing', () => {
  const editor = useEditorStore();
  const library = useLibraryStore();
  const workspace = useWorkspaceStore();
  const navigation = useWorkbenchStore();
  const candidates = shallowRef<CandidateSummary[]>([]);
  const details = shallowRef<CandidateDetails | null>(null);
  const draft = ref<DraftRequest | null>(null);
  const rewrite = ref<{
    selection: RewriteSelection;
    plan: RewritePlan;
    packId: string;
    model: WritingModel | null;
    allowStalePack: boolean;
  } | null>(null);
  const models = shallowRef<ChaptaleModelInfo[]>([]);
  const ranges = shallowRef<Array<{ label: string; from: number; to: number }>>([]);
  const running = ref<string[]>([]);
  const error = ref('');
  const busy = ref(false);
  const diagnostics = ref<string[]>([]);
  let sequence = 0;
  const usable = computed(() =>
    Boolean(details.value && ['ready', 'partially-accepted'].includes(details.value.candidate.status))
  );

  async function refresh() {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const token = ++sequence;
    try {
      const result = await getDesktopApi().writing.listCandidates({ rootPath });
      if (token !== sequence || rootPath !== workspace.rootPath) return;
      candidates.value = result.candidates;
      diagnostics.value = result.diagnostics;
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    }
  }
  async function read(candidateId: string) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    try {
      const result = await getDesktopApi().writing.readCandidate({ rootPath, candidateId });
      if (rootPath === workspace.rootPath) {
        details.value = result;
        error.value = '';
      }
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }
  async function prepare(parentId?: string) {
    let tab = editor.activeTab;
    if (library.scenePath && tab?.path === library.scenePath) {
      if (!library.chapterPath) {
        error.value = '场景卡未关联有效章节，请先选择目标正文';
        navigation.auxiliary = 'candidates';
        return;
      }
      await editor.openDocument(library.chapterPath);
      tab = editor.activeTab;
    }
    if (!tab?.document || tab.readonly || tab.dirty || tab.saving || tab.external) {
      error.value = '请打开已保存的 Markdown 正文';
      navigation.auxiliary = 'candidates';
      return;
    }
    if (!library.goal.trim()) {
      navigation.auxiliary = 'references';
      library.error = '请先填写本次写作目标';
      return;
    }
    try {
      const rootPath = workspace.rootPath!;
      const pack = await library.freeze();
      if (!pack) throw new Error(library.error || '参考冻结失败');
      const available = await getDesktopApi().models.list();
      if (rootPath !== workspace.rootPath) return;
      models.value = available.models.filter(model => model.authConfigured);
      const model = models.value.find(value => value.isDefault) ?? models.value[0];
      if (!model) throw new Error('尚未配置可用模型');
      const text = normalizeDocumentText(tab.document.content);
      const bodyStart =
        tab.document.head.status === 'ok' ? text.length - normalizeDocumentText(tab.document.head.body).length : 0;
      const selected = editor.getBuffer(tab.id)?.state.selection.main;
      ranges.value = [
        { label: '替换正文', from: bodyStart, to: text.length },
        { label: '追加到正文末尾', from: text.length, to: text.length },
        ...(selected && selected.from >= bodyStart
          ? [{ label: selected.empty ? '在光标处插入' : '替换选区', from: selected.from, to: selected.to }]
          : [])
      ];
      const range =
        selected && !selected.empty && selected.from >= bodyStart
          ? { from: selected.from, to: selected.to }
          : { from: bodyStart, to: text.length };
      draft.value = {
        rootPath,
        candidateId: crypto.randomUUID(),
        targetPath: tab.path,
        expectedHash: tab.document.contentHash,
        range,
        packId: pack.id,
        allowStalePack: false,
        model: { provider: model.provider, modelId: model.id },
        ...(parentId ? { parentId } : {})
      };
      error.value = '';
    } catch (cause) {
      error.value = toErrorMessage(cause);
      navigation.auxiliary = 'candidates';
    }
  }
  async function generate() {
    const request = draft.value;
    if (!request) return;
    draft.value = null;
    return runGeneration(request, () => getDesktopApi().writing.generate(request));
  }
  async function runGeneration(
    request: { rootPath: string; candidateId: string },
    run: () => Promise<CandidateDetails>
  ) {
    running.value.push(request.candidateId);
    navigation.auxiliary = 'candidates';
    error.value = '';
    try {
      const result = await run();
      if (workspace.rootPath === request.rootPath) details.value = result;
    } catch (cause) {
      if (workspace.rootPath === request.rootPath) error.value = toErrorMessage(cause);
    } finally {
      running.value = running.value.filter(id => id !== request.candidateId);
      if (workspace.rootPath === request.rootPath) await refresh();
    }
  }
  async function prepareRewrite(reviewId: string, issueIndexes: number[]) {
    const rootPath = workspace.rootPath!;
    error.value = '';
    try {
      const selection = { rootPath, reviewId, issueIndexes };
      const plan = await getDesktopApi().writing.prepareRewrite(selection);
      const tab = editor.tabs.find(value => value.path === plan.targetPath);
      if (tab && (tab.dirty || tab.saving || tab.external)) throw new Error('请先保存目标正文或处理外部变化');
      const available = await getDesktopApi().models.list();
      const packId =
        plan.packId ??
        (
          await getDesktopApi().library.freezePack({
            rootPath,
            goal: '按选中的审查问题最小修订',
            selections: [],
            budgetChars: 9000
          })
        ).id;
      if (rootPath !== workspace.rootPath) return;
      models.value = available.models.filter(model => model.authConfigured);
      const model = models.value.find(value => value.isDefault) ?? models.value[0];
      rewrite.value = {
        selection,
        plan,
        packId,
        allowStalePack: false,
        model: model ? { provider: model.provider, modelId: model.id } : null
      };
    } catch (cause) {
      if (rootPath === workspace.rootPath) error.value = toErrorMessage(cause);
    }
  }
  async function generateRewrite() {
    const confirmation = rewrite.value;
    if (!confirmation?.model) return;
    const request = {
      ...confirmation.selection,
      candidateId: crypto.randomUUID(),
      expectedHash: confirmation.plan.expectedHash,
      sourceHash: confirmation.plan.sourceHash,
      outputHash: confirmation.plan.outputHash,
      packId: confirmation.packId,
      allowStalePack: confirmation.allowStalePack,
      model: confirmation.model
    };
    rewrite.value = null;
    return runGeneration(request, () => getDesktopApi().writing.rewrite(request));
  }
  async function cancel(candidateId: string) {
    try {
      await getDesktopApi().writing.cancel({ rootPath: workspace.rootPath!, candidateId });
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }
  async function discard() {
    if (!details.value) return;
    busy.value = true;
    try {
      details.value = await getDesktopApi().writing.discard({
        rootPath: workspace.rootPath!,
        candidateId: details.value.candidate.id
      });
      await refresh();
    } catch (cause) {
      error.value = toErrorMessage(cause);
    } finally {
      busy.value = false;
    }
  }
  async function apply(changeIndexes: number[]) {
    const candidate = details.value?.candidate;
    if (!candidate || busy.value) return;
    busy.value = true;
    try {
      const result = await editor.acceptDocumentChange(candidate.targetPath, candidate.baselineHash, () =>
        getDesktopApi().writing.apply({
          rootPath: workspace.rootPath!,
          candidateId: candidate.id,
          revision: candidate.revision,
          changeIndexes
        })
      );
      details.value = result.details;
      error.value = '';
      await refresh();
    } catch (cause) {
      const message = toErrorMessage(cause);
      await read(candidate.id);
      error.value = message;
    } finally {
      busy.value = false;
    }
  }
  watch(
    () => workspace.rootPath,
    () => {
      ++sequence;
      candidates.value = [];
      details.value = null;
      draft.value = null;
      rewrite.value = null;
      running.value = [];
      error.value = '';
      diagnostics.value = [];
    }
  );
  return {
    candidates,
    details,
    draft,
    rewrite,
    models,
    ranges,
    running,
    error,
    diagnostics,
    busy,
    usable,
    refresh,
    read,
    prepare,
    generate,
    prepareRewrite,
    generateRewrite,
    cancel,
    discard,
    apply
  };
});
