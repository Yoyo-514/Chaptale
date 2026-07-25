import { describe, expect, it, vi } from 'vitest';

import type { PermissionAskEvent } from '@chaptale/ipc-contract';

import type { SessionCtx } from '../../session-ctx/types';
import { PermissionBroker } from '../broker';

const SESSION_CTX: SessionCtx = { sessionId: 's1', cwd: '/workspace-a', scope: 'workspace' };

function createBroker(timeoutMs = 1000) {
  const asks: PermissionAskEvent[] = [];
  const broker = new PermissionBroker({ timeoutMs });
  broker.onAsk(event => asks.push(event));
  return { broker, asks };
}

describe('PermissionBroker', () => {
  it('resolves the pending promise with the user decision without exposing cwd to renderer events', async () => {
    const { broker, asks } = createBroker();
    const pending = broker.ask({ ctx: SESSION_CTX, toolName: 'write', riskLevel: 'mutating', subject: 'a.md' });

    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ sessionId: 's1', toolName: 'write', riskLevel: 'mutating', subject: 'a.md' });
    expect(asks[0]).not.toHaveProperty('cwd');
    expect(broker.getPending(asks[0].requestId)).toMatchObject({ ctx: SESSION_CTX, event: asks[0] });
    expect(broker.decide(asks[0].requestId, { outcome: 'allow-once' })).toMatchObject({ toolName: 'write' });
    await expect(pending).resolves.toEqual({ outcome: 'allow-once' });
    // 已决请求再次决策返回 null。
    expect(broker.decide(asks[0].requestId, { outcome: 'deny' })).toBeNull();
    expect(broker.getPending(asks[0].requestId)).toBeNull();
  });

  it('denies on timeout', async () => {
    vi.useFakeTimers();

    try {
      const { broker } = createBroker(50);
      const pending = broker.ask({ ctx: SESSION_CTX, toolName: 'write', riskLevel: 'mutating' });
      vi.advanceTimersByTime(60);
      await expect(pending).resolves.toMatchObject({ outcome: 'deny' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects all pending requests of an interrupted session only', async () => {
    const { broker, asks } = createBroker();
    const a = broker.ask({ ctx: SESSION_CTX, toolName: 'write', riskLevel: 'mutating' });
    void broker.ask({ ctx: { ...SESSION_CTX, sessionId: 's2' }, toolName: 'edit', riskLevel: 'mutating' });

    broker.rejectSession('s1');

    await expect(a).resolves.toMatchObject({ outcome: 'deny' });
    expect(broker.listPending()).toHaveLength(1);
    expect(broker.listPending('s2')).toHaveLength(1);
    expect(broker.decide(asks[1].requestId, { outcome: 'allow-once' })).not.toBeNull();
  });

  it('lists pending requests filtered by session', () => {
    const { broker } = createBroker();
    void broker.ask({ ctx: SESSION_CTX, toolName: 'write', riskLevel: 'mutating' });
    void broker.ask({ ctx: SESSION_CTX, toolName: 'bash', riskLevel: 'destructive', subject: 'rm -rf x' });

    expect(broker.listPending('s1').map(event => event.toolName)).toEqual(['write', 'bash']);
    expect(broker.listPending('other')).toEqual([]);
  });
});
