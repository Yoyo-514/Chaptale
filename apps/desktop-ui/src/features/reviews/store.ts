import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';

import type { ChaptaleModelInfo, ReviewRunArgs } from '@chaptale/ipc-contract';
import {
  normalizeDocumentText,
  REVIEWERS,
  resolveReviewAnchor,
  type Candidate,
  type IssueStatus,
  type ReviewDetails,
  type ReviewJobSummary,
  type ReviewMark
} from '@chaptale/shared';

import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const useReviewStore = defineStore('review-workflow', () => {
  const editor = useEditorStore();
  const workspace = useWorkspaceStore();
  const library = useLibraryStore();
  const navigation = useWorkbenchStore();
  const jobs = shallowRef<ReviewJobSummary[]>([]);
  const details = shallowRef<ReviewDetails | null>(null);
  const confirmation = ref<Omit<ReviewRunArgs, 'requestId' | 'personaId'> | null>(null);
  const enabled = ref<string[]>(REVIEWERS.map(reviewer => reviewer.id));
  const models = shallowRef<ChaptaleModelInfo[]>([]);
  const running = ref<Array<{ id: string; personaId: string }>>([]);
  const error = ref('');
  const diagnostics = ref<string[]>([]);
  const selectedIssue = ref<number | null>(null);
  const severity = ref('all');
  const issueType = ref('all');
  const issueStatus = ref('open');
  let sequence = 0;
  const source = computed(() => {
    const job = details.value?.job;
    if (!job) return '';
    if (job.candidateId) return job.text;
    const tab = editor.tabs.find(value => value.path === job.targetPath);
    return tab
      ? (editor.getBuffer(tab.id)?.state.doc.toString() ?? normalizeDocumentText(tab.document?.content ?? job.text))
      : job.text;
  });
  const issues = computed(
    () =>
      details.value?.result?.issues.map((issue, index) => ({
        issue,
        index,
        status: details.value?.state?.issues[String(index)]?.status ?? 'open',
        anchor: resolveReviewAnchor(source.value, issue)
      })) ?? []
  );
  const visibleIssues = computed(() =>
    issues.value.filter(
      value =>
        (severity.value === 'all' || value.issue.severity === severity.value) &&
        (issueType.value === 'all' || value.issue.type === issueType.value) &&
        (issueStatus.value === 'all' || value.status === issueStatus.value)
    )
  );
  const needsRereview = computed(() => {
    const open = issues.value.filter(value => value.status === 'open');
    return open.length > 0 && open.filter(value => value.anchor.stale).length / open.length > 0.5;
  });
  function marks(targetPath: string): ReviewMark[] {
    if (!details.value || details.value.job.candidateId || details.value.job.targetPath !== targetPath) return [];
    return issues.value.flatMap(value =>
      value.status === 'open' && !value.anchor.stale
        ? [{ id: String(value.index), from: value.anchor.start, to: value.anchor.end, severity: value.issue.severity }]
        : []
    );
  }
  async function refresh() {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const token = ++sequence;
    try {
      const result = await getDesktopApi().reviews.list({ rootPath });
      if (token === sequence && rootPath === workspace.rootPath) {
        jobs.value = result.jobs;
        diagnostics.value = result.diagnostics;
      }
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    }
  }
  async function read(requestId: string) {
    const rootPath = workspace.rootPath!;
    try {
      const result = await getDesktopApi().reviews.read({ rootPath, requestId });
      if (rootPath !== workspace.rootPath) return;
      details.value = result;
      error.value = '';
      selectedIssue.value = null;
      navigation.auxiliary = 'review';
      if (!result.job.candidateId) await editor.openDocument(result.job.targetPath);
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }
  async function prepare(personaId?: string, candidate?: Candidate) {
    navigation.auxiliary = 'review';
    const tab = editor.activeTab;
    if (!candidate && (!tab?.document || tab.dirty || tab.saving || tab.readonly || tab.external)) {
      error.value = '请先打开并保存正文';
      return;
    }
    const rootPath = workspace.rootPath!;
    try {
      const available = await getDesktopApi().models.list();
      if (rootPath !== workspace.rootPath) return;
      models.value = available.models.filter(model => model.authConfigured);
      const model = models.value.find(value => value.isDefault) ?? models.value[0];
      if (!model) throw new Error('尚未配置可用模型');
      if (personaId) enabled.value = [personaId];
      const packId = candidate?.packId ?? library.frozen?.id;
      confirmation.value = {
        rootPath,
        targetPath: candidate?.targetPath ?? tab!.path,
        expectedHash: candidate?.baselineHash ?? tab!.document!.contentHash,
        ...(candidate ? { candidateId: candidate.id, candidateRevision: candidate.revision } : {}),
        ...(packId ? { packId } : {}),
        allowStalePack: false,
        model: { provider: model.provider, modelId: model.id }
      };
      error.value = '';
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }
  async function start() {
    const request = confirmation.value;
    if (!request) return;
    confirmation.value = null;
    const selected = REVIEWERS.filter(reviewer => enabled.value.includes(reviewer.id));
    await Promise.allSettled(
      selected.map(async reviewer => {
        const id = crypto.randomUUID();
        running.value.push({ id, personaId: reviewer.id });
        try {
          const result = await getDesktopApi().reviews.run({ ...request, requestId: id, personaId: reviewer.id });
          if (workspace.rootPath === request.rootPath && !details.value) details.value = result;
        } catch (cause) {
          if (workspace.rootPath === request.rootPath) error.value = `${reviewer.label}：${toErrorMessage(cause)}`;
        } finally {
          running.value = running.value.filter(value => value.id !== id);
          if (workspace.rootPath === request.rootPath) await refresh();
        }
      })
    );
  }
  async function cancel(requestId: string) {
    try {
      await getDesktopApi().reviews.cancel({ rootPath: workspace.rootPath!, requestId });
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }
  async function resolve(indexes: number[], status: IssueStatus) {
    const job = details.value?.job;
    if (!job) return;
    const rootPath = workspace.rootPath!;
    try {
      const result = await getDesktopApi().reviews.resolve({
        rootPath,
        requestId: job.id,
        issueIndexes: indexes,
        status
      });
      if (workspace.rootPath === rootPath && details.value?.job.id === job.id) details.value = result;
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }
  async function locate(index: number) {
    selectedIssue.value = index;
    navigation.auxiliary = 'review';
    const value = issues.value[index];
    const job = details.value?.job;
    if (!value || value.anchor.stale || !job || job.candidateId) return;
    await editor.locate(job.targetPath, value.anchor.start, value.anchor.end);
  }
  function selectMark(id: string) {
    selectedIssue.value = Number(id);
    navigation.auxiliary = 'review';
  }
  watch(
    () => workspace.rootPath,
    () => {
      ++sequence;
      jobs.value = [];
      details.value = null;
      confirmation.value = null;
      error.value = '';
      running.value = [];
      diagnostics.value = [];
    }
  );
  return {
    jobs,
    details,
    confirmation,
    enabled,
    models,
    running,
    error,
    diagnostics,
    selectedIssue,
    severity,
    issueType,
    issueStatus,
    issues,
    visibleIssues,
    needsRereview,
    source,
    marks,
    refresh,
    read,
    prepare,
    start,
    cancel,
    resolve,
    locate,
    selectMark
  };
});
