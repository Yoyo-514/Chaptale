import { describe, expect, it } from 'vitest';

import { AgentRunManager } from '../run-manager';

describe('AgentRunManager', () => {
  it('starts runs with independent abort signals', () => {
    const manager = new AgentRunManager();
    const first = manager.start('run-1', 'session-1');
    const second = manager.start('run-2', 'session-2');

    expect(first.aborted).toBe(false);
    expect(second.aborted).toBe(false);

    manager.cancel('run-1');
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it('invalidates the run signal on finish and ignores unknown cancellation', () => {
    const manager = new AgentRunManager();
    const signal = manager.start('run-1', 'session-1');

    manager.finish('run-1');
    manager.cancel('run-1');

    expect(signal.aborted).toBe(true);
    expect(() => manager.cancel('missing')).not.toThrow();
  });

  it('rejects a duplicate active run id without replacing the original scope', () => {
    const manager = new AgentRunManager();
    const signal = manager.start('run-1', 'session-1');

    expect(() => manager.start('run-1', 'session-2')).toThrow('runId 已存在');
    expect(manager.getRunScope('run-1')).toEqual({ sessionId: 'session-1', signal });
    expect(signal.aborted).toBe(false);
  });

  it('records the session for an active run and removes it on finish', () => {
    const manager = new AgentRunManager();

    const signal = manager.start('run-1', 'session-1');
    expect(manager.getRunScope('run-1')).toEqual({ sessionId: 'session-1', signal });

    manager.finish('run-1');
    expect(manager.getRunScope('run-1')).toBeUndefined();
  });
});
