import { randomUUID } from 'node:crypto';

import type { Approval, HostChange } from '../protocol.ts';
import type { HostToolAuthorizer, HostToolDecision } from '../tools/tool-access.ts';

/**
 * 等待作者处理的工具授权请求。
 * 调用被取消时请求按拒绝结束；结束后的批准不会再生效。
 */
export class ToolApprovals {
  private readonly pending = new Map<string, { value: Approval; finish: (decision: HostToolDecision) => void }>();
  private readonly emit: (change: HostChange) => void;

  constructor(emit: (change: HostChange) => void) {
    this.emit = emit;
  }

  readonly authorize: HostToolAuthorizer = (request, signal) =>
    new Promise(resolve => {
      const id = randomUUID();
      const value: Approval = { id, ...request };
      const finish = (decision: HostToolDecision) => {
        signal?.removeEventListener('abort', cancelled);
        this.pending.delete(id);
        this.emit({ kind: 'approval-closed', id });
        resolve(decision);
      };
      const cancelled = () => finish({ allow: false, reason: '调用已取消' });
      signal?.addEventListener('abort', cancelled, { once: true });
      this.pending.set(id, { value, finish });
      this.emit({ kind: 'approval', approval: value });
    });

  approve(id: string, allow: boolean): void {
    const request = this.pending.get(id);
    if (!request) throw new Error('授权请求已结束，请查看当前状态');
    request.finish({ allow });
  }

  list(): Approval[] {
    return [...this.pending.values()].map(({ value }) => value);
  }
}
