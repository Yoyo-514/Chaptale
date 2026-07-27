import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

import { useTodoProgress } from '../composables/useTodoProgress';

describe('useTodoProgress', () => {
  beforeEach(() => {
    delete window.chaptaleDesktop;
  });

  it('returns an empty hidden progress model without the desktop bridge', () => {
    let model!: ReturnType<typeof useTodoProgress>;

    const wrapper = mount(
      defineComponent({
        setup() {
          model = useTodoProgress(() => 'session-1');
          return () => null;
        }
      })
    );

    expect(model.items.value).toEqual([]);
    expect(model.total.value).toBe(0);
    expect(model.completedCount.value).toBe(0);
    expect(model.visible.value).toBe(false);

    wrapper.unmount();
  });
});
