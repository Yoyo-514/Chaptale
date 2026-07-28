import type { ReviewOutputStore } from '../features/reviews/store';
import type { AgentRunStore } from '../features/runs/store';
import type { TaskOutputStorePort, TaskStoredOutput } from '../features/tasks/output-port';
import { isSafeRunId } from '../infra/filesystem/safe-output-file';

const REVIEW_REF_PREFIX = '.chaptale/reviews/';
const RAW_REF_PREFIX = '.chaptale/runs/outputs/';

export type TaskOutputRouterOptions = {
  runStore: AgentRunStore;
  reviewStore: ReviewOutputStore;
};

/**
 * task 输出路由器：按领域边界决定写入 raw runs output 还是 review 结构化结果。
 * TaskRunner 只依赖窄端口，具体存储组合留在 app 装配层。
 */
export class TaskOutputRouter implements TaskOutputStorePort {
  constructor(private readonly options: TaskOutputRouterOptions) {}

  async saveSuccess(input: {
    runId: string;
    isReview: boolean;
    output: unknown;
    rawText: string;
    cwd: string;
  }): Promise<string> {
    if (input.isReview) {
      return this.options.reviewStore.save(input.runId, input.output, input.cwd);
    }

    return this.options.runStore.saveOutput(input.runId, input.rawText, input.cwd);
  }

  async saveFailure(input: { runId: string; rawText: string; cwd: string }): Promise<string> {
    return this.options.runStore.saveOutput(input.runId, input.rawText, input.cwd);
  }

  async read(outputRef: string): Promise<TaskStoredOutput | null> {
    if (isDirectStoreRef(outputRef, REVIEW_REF_PREFIX)) {
      return this.options.reviewStore.read(outputRef);
    }

    if (isDirectStoreRef(outputRef, RAW_REF_PREFIX)) {
      const output = await this.options.runStore.readOutput(outputRef);
      return output ? { kind: 'raw', ...output } : null;
    }

    return null;
  }

  async remove(outputRef: string, cwd: string): Promise<void> {
    if (isDirectStoreRef(outputRef, REVIEW_REF_PREFIX)) {
      await this.options.reviewStore.remove(outputRef, cwd);
      return;
    }

    if (isDirectStoreRef(outputRef, RAW_REF_PREFIX)) {
      await this.options.runStore.removeOutput(outputRef, cwd);
    }
  }
}

function isDirectStoreRef(outputRef: string, prefix: string): boolean {
  if (!outputRef.startsWith(prefix) || !outputRef.endsWith('.json')) {
    return false;
  }

  const runId = outputRef.slice(prefix.length, -'.json'.length);
  return isSafeRunId(runId);
}
