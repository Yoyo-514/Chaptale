/** 跟踪进行中的 Agent 运行，收敛 AbortController 的生命周期管理。 */
export class AgentRunManager {
  private readonly controllers = new Map<string, AbortController>();

  start(runId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller.signal;
  }

  cancel(runId: string) {
    this.controllers.get(runId)?.abort();
    this.controllers.delete(runId);
  }

  finish(runId: string) {
    this.controllers.delete(runId);
  }
}
