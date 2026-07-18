import { describe, expect, it } from 'vitest';

import { AgentRunManager } from '../run-manager';

describe('AgentRunManager', () => {
  it('starts runs with independent abort signals', () => {
    const manager = new AgentRunManager();
    const first = manager.start('run-1');
    const second = manager.start('run-2');

    expect(first.aborted).toBe(false);
    expect(second.aborted).toBe(false);

    manager.cancel('run-1');
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it('ignores cancel for finished or unknown runs', () => {
    const manager = new AgentRunManager();
    const signal = manager.start('run-1');

    manager.finish('run-1');
    manager.cancel('run-1');

    expect(signal.aborted).toBe(false);
    expect(() => manager.cancel('missing')).not.toThrow();
  });
});
