import { randomUUID } from 'node:crypto';

import type { Approval, ApprovalRememberOption, HostChange } from '../protocol.ts';
import type { HostToolDecision, HostToolRequest } from '../tools/tool-access.ts';

export interface PendingApprovalEntry {
  value: Approval;
  workId: string | null;
  target?: string;
}

/**
 * 等待作者处理的工具授权请求。
 * 调用被取消时请求按拒绝结束；结束后的批准不会再生效。
 */
export class ToolApprovals {
  private readonly pending = new Map<string, PendingApprovalEntry & { finish: (decision: HostToolDecision) => void }>();
  private readonly emit: (change: HostChange) => void;

  constructor(emit: (change: HostChange) => void) {
    this.emit = emit;
  }

  enqueue(
    request: HostToolRequest & { workId?: string | null; target?: string; remember?: ApprovalRememberOption },
    signal: AbortSignal | undefined
  ): Promise<HostToolDecision> {
    return new Promise(resolve => {
      const id = randomUUID();
      const value: Approval = {
        id,
        sessionId: request.sessionId,
        toolName: request.toolName,
        input: request.input,
        cwd: request.cwd,
        ...(request.remember && { remember: request.remember })
      };
      const finish = (decision: HostToolDecision) => {
        signal?.removeEventListener('abort', cancelled);
        if (!this.pending.delete(id)) return;
        this.emit({ kind: 'approval-closed', id });
        resolve(decision);
      };
      const cancelled = () => finish({ allow: false, reason: '调用已取消' });
      signal?.addEventListener('abort', cancelled, { once: true });
      if (signal?.aborted) {
        resolve({ allow: false, reason: '调用已取消' });
        return;
      }
      this.pending.set(id, {
        value,
        workId: request.workId ?? null,
        target: request.target,
        finish
      });
      this.emit({ kind: 'approval', approval: value });
    });
  }

  peek(id: string): PendingApprovalEntry | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    return { value: entry.value, workId: entry.workId, target: entry.target };
  }

  finish(id: string, decision: HostToolDecision): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.finish(decision);
    return true;
  }

  allowMatching(predicate: (entry: PendingApprovalEntry) => boolean): void {
    for (const [id, entry] of this.pending) {
      if (predicate(entry)) this.finish(id, { allow: true });
    }
  }

  cancelAll(): void {
    for (const id of this.pending.keys()) {
      this.finish(id, { allow: false, reason: '调用已取消' });
    }
  }

  list(): Approval[] {
    return [...this.pending.values()].map(({ value }) => value);
  }
}
