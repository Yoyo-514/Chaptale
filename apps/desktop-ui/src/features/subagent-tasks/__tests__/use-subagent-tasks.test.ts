import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

import { isTerminalState, useSubagentTasks } from '../composables/useSubagentTasks';

describe('isTerminalState', () => {
  beforeEach(() => {
    delete window.chaptaleDesktop;
  });

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

  it('returns an empty task list and no-op actions without the desktop bridge', async () => {
    let model!: ReturnType<typeof useSubagentTasks>;

    const wrapper = mount(
      defineComponent({
        setup() {
          model = useSubagentTasks(() => 'session-1');
          return () => null;
        }
      })
    );

    expect(model.tasks.value).toEqual([]);
    await expect(model.cancel('request-1')).resolves.toBeUndefined();
    expect(() => model.dismiss('request-1')).not.toThrow();

    wrapper.unmount();
  });
});
