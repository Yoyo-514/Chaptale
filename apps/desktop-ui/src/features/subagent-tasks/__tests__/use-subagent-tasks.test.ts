import { describe, expect, it } from 'vitest';

import { isTerminalState } from '../composables/useSubagentTasks';

describe('isTerminalState', () => {
  it('treats success, failed, cancelled, and timeout as terminal states', () => {
    expect(isTerminalState('success')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('cancelled')).toBe(true);
    expect(isTerminalState('timeout')).toBe(true);
  });

  it('treats queued and running as non-terminal states', () => {
    expect(isTerminalState('queued')).toBe(false);
    expect(isTerminalState('running')).toBe(false);
  });
});
