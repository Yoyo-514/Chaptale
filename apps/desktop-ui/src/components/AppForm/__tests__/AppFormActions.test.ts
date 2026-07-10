import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppFormActions from '../AppFormActions.vue';

describe('AppFormActions', () => {
  it('aligns actions to the end by default', () => {
    const wrapper = mount(AppFormActions, {
      slots: {
        default: '<button type="submit">保存</button>'
      }
    });

    expect(wrapper.classes()).toContain('app-form-actions-end');
    expect(wrapper.attributes('data-slot')).toBe('app-form-actions');
    expect(wrapper.find('[data-slot="app-form-actions-main"] button').text()).toBe('保存');
  });

  it('supports leading actions, compact spacing and sticky mode', () => {
    const wrapper = mount(AppFormActions, {
      props: {
        align: 'between',
        compact: true,
        sticky: true
      },
      attrs: {
        class: 'custom-actions',
        'aria-label': '表单操作'
      },
      slots: {
        leading: '<button type="button">恢复默认</button>',
        default: '<button type="submit">保存</button>'
      }
    });

    expect(wrapper.classes()).toContain('app-form-actions-between');
    expect(wrapper.classes()).toContain('app-form-actions-compact');
    expect(wrapper.classes()).toContain('app-form-actions-sticky');
    expect(wrapper.classes()).toContain('custom-actions');
    expect(wrapper.attributes('aria-label')).toBe('表单操作');
    expect(wrapper.find('[data-slot="app-form-actions-leading"]').text()).toBe('恢复默认');
    expect(wrapper.find('[data-slot="app-form-actions-main"]').text()).toBe('保存');
  });
});
