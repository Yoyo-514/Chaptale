import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import AppAlertDialog from '../AppAlertDialog.vue';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppAlertDialog', () => {
  it('supports a controlled dialog without a trigger slot', async () => {
    const wrapper = mount(AppAlertDialog, {
      attachTo: document.body,
      props: {
        open: true,
        title: '删除规则？',
        description: '删除后立即生效',
        confirmLabel: '删除'
      }
    });
    await nextTick();

    expect(document.body.textContent).toContain('删除规则？');
    const confirm = document.querySelector<HTMLElement>('[data-slot="app-alert-dialog-confirm"]');
    expect(confirm).not.toBeNull();

    confirm?.click();
    await nextTick();

    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('update:open')).toContainEqual([false]);
    wrapper.unmount();
  });
});
