import { reactive } from 'vue';

import type { ContinuityIssues } from '@chaptale/shared';

import { getDesktopApi } from '@/stores/utils/desktop-api';

export type ReviewStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export type ContinuityReviewState = {
  status: ReviewStatus;
  runId: string | null;
  issues: ContinuityIssues['issues'];
  summary: string;
  /** 校验失败/修复耗尽时的错误列表。 */
  errors: string[];
  /** 失败时原始输出的落盘路径（可查但不做结构化展示）。 */
  outputRef: string | null;
};

/**
 * 连贯性审查：对当前输入框文本发起一次 task 型审查。
 *
 * UI 只渲染结构化结果（issues 列表），不做任何 LLM 文本聚合；
 * 同时间只允许一个审查在跑，重复点击直接忽略。
 */
export function useContinuityReview(getText: () => string, getContextFilePaths: () => string[]) {
  const state = reactive<ContinuityReviewState>({
    status: 'idle',
    runId: null,
    issues: [],
    summary: '',
    errors: [],
    outputRef: null
  });

  function reset() {
    state.status = 'idle';
    state.runId = null;
    state.issues = [];
    state.summary = '';
    state.errors = [];
    state.outputRef = null;
  }

  async function start() {
    if (state.status === 'running') {
      return;
    }

    const text = getText().trim();
    const contextFilePaths = getContextFilePaths();

    // 粘贴文本与附件文本至少其一，否则没有可审查的内容。
    if (!text && contextFilePaths.length === 0) {
      return;
    }

    reset();
    state.status = 'running';

    try {
      const result = await getDesktopApi().tasks.run({
        personaId: 'continuity-reviewer',
        brief: '审查以下文本的连贯性问题',
        text,
        ...(contextFilePaths.length > 0 ? { contextFilePaths } : {})
      });

      state.runId = result.runId;

      if (result.status === 'success') {
        const output = result.output as ContinuityIssues;
        state.issues = output.issues;
        state.summary = output.summary;
        state.outputRef = result.outputRef;
        state.status = 'done';
        return;
      }

      if (result.status === 'failed') {
        state.errors = result.errors;
        state.outputRef = result.outputRef;
        state.status = 'failed';
        return;
      }

      state.status = 'cancelled';
    } catch (error) {
      state.errors = [error instanceof Error ? error.message : String(error)];
      state.status = 'failed';
    }
  }

  async function cancel() {
    if (state.status !== 'running' || !state.runId) {
      return;
    }

    await getDesktopApi().tasks.cancel(state.runId);
  }

  return { state, start, cancel, dismiss: reset };
}
