import { randomUUID } from 'node:crypto';

import type { PermissionAskEvent } from '@chaptale/ipc-contract';
import type { PermissionDecision } from '@chaptale/shared';

import type { RiskLevel } from './protocol';

interface PendingEntry {
  resolve: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
  event: PermissionAskEvent;
}

interface PermissionBrokerOptions {
  /** ask 挂起的上限；超时按拒绝处理，agent 循环不能被无限阻塞。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * ask 决策的挂起中枢：工具执行在此等待用户决定。
 * 超时、会话取消都会以拒绝收尾，保证每个挂起的 Promise 必达终态。
 */
export class PermissionBroker {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly askListeners: Array<(event: PermissionAskEvent) => void> = [];
  private readonly timeoutMs: number;

  constructor(options: PermissionBrokerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 订阅新请求（用于向 renderer 广播）。 */
  onAsk(listener: (event: PermissionAskEvent) => void): void {
    this.askListeners.push(listener);
  }

  ask(input: {
    sessionId: string;
    toolName: string;
    riskLevel: RiskLevel;
    subject?: string;
  }): Promise<PermissionDecision> {
    const event: PermissionAskEvent = { requestId: randomUUID(), ...input };

    return new Promise<PermissionDecision>(resolve => {
      const timer = setTimeout(() => {
        this.settle(event.requestId, { outcome: 'deny', reason: '授权请求超时，未获得用户确认' });
      }, this.timeoutMs);

      this.pending.set(event.requestId, { resolve, timer, event });

      for (const listener of this.askListeners) {
        listener(event);
      }
    });
  }

  /** 用户决策；返回对应请求（供规则落库等后续处理），不存在（已超时/已决）时返回 null。 */
  decide(requestId: string, decision: PermissionDecision): PermissionAskEvent | null {
    const entry = this.pending.get(requestId) ?? null;
    this.settle(requestId, decision);
    return entry?.event ?? null;
  }

  /** 待决请求快照，供 renderer 挂载或刷新后恢复授权卡片。 */
  listPending(sessionId?: string): PermissionAskEvent[] {
    const events = [...this.pending.values()].map(entry => entry.event);
    return sessionId ? events.filter(event => event.sessionId === sessionId) : events;
  }

  /** 会话中断时拒绝其全部挂起请求，释放被阻塞的工具执行。 */
  rejectSession(sessionId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.event.sessionId === sessionId) {
        this.settle(requestId, { outcome: 'deny', reason: '会话已中断' });
      }
    }
  }

  private settle(requestId: string, decision: PermissionDecision): boolean {
    const entry = this.pending.get(requestId);

    if (!entry) {
      return false;
    }

    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve(decision);
    return true;
  }
}
