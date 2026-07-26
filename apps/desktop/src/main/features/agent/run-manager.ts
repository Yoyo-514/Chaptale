import type { AgentRunScope } from '@chaptale/ipc-contract';

/** 主进程为活跃 Agent 运行保存的取消控制器与可信会话归属。 */
type AgentRunRecord = {
  sessionId: string;
  controller: AbortController;
};

/** 跟踪进行中的 Agent 运行，收敛会话归属与 AbortController 生命周期。 */
export class AgentRunManager {
  private readonly runs = new Map<string, AgentRunRecord>();

  /** 登记一条新运行并返回它独立的 AbortSignal。 */
  start(runId: string, sessionId: string): AbortSignal {
    // 拒绝覆盖可避免旧运行 finally 按同一 key 删除仍活跃的新运行。
    if (this.runs.has(runId)) {
      throw new Error(`Agent runId 已存在：${runId}`);
    }

    const controller = new AbortController();
    this.runs.set(runId, { sessionId, controller });
    return controller.signal;
  }

  /** 返回与原 runId 绑定的会话和信号；终态运行不再可解析。 */
  getRunScope(runId: string): AgentRunScope | undefined {
    const record = this.runs.get(runId);
    return record ? { sessionId: record.sessionId, signal: record.controller.signal } : undefined;
  }

  /** 中断并删除指定运行；未知运行保持幂等。 */
  cancel(runId: string): void {
    this.invalidate(runId);
  }

  /** 使终态运行的并发 steer/clear 失效，再删除登记。 */
  finish(runId: string): void {
    this.invalidate(runId);
  }

  /** 统一中止运行级信号，确保异步边界之后仍能识别原运行已结束。 */
  private invalidate(runId: string): void {
    this.runs.get(runId)?.controller.abort();
    this.runs.delete(runId);
  }
}
