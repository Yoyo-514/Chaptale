import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppFormGrid from '../AppFormGrid.vue';

describe('AppFormGrid', () => {
  it('uses responsive columns and small gap by default', () => {
    const wrapper = mount(AppFormGrid, {
      slots: {
        default: '<div>字段</div>'
      }
    });

    expect(wrapper.classes()).toContain('app-form-grid-responsive');
    expect(wrapper.attributes('data-slot')).toBe('app-form-grid');
    expect(wrapper.text()).toBe('字段');
  });

  it('supports fixed columns and native attributes', () => {
    const wrapper = mount(AppFormGrid, {
      props: {
        columns: 2
      },
      attrs: {
        class: 'custom-grid',
        role: 'group'
      }
    });

    expect(wrapper.classes()).toContain('app-form-grid-2');
    expect(wrapper.classes()).toContain('custom-grid');
    expect(wrapper.attributes('role')).toBe('group');
  });
});
