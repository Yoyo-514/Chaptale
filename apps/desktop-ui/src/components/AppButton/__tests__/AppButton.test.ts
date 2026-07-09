import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppButton from '../AppButton.vue';

describe('AppButton', () => {
  it('renders slot content', () => {
    const wrapper = mount(AppButton, {
      slots: {
        default: '保存'
      }
    });

    expect(wrapper.text()).toBe('保存');
  });

  it('uses button type by default', () => {
    const wrapper = mount(AppButton);

    expect(wrapper.attributes('type')).toBe('button');
  });

  it('passes disabled state to native button', () => {
    const wrapper = mount(AppButton, {
      props: {
        disabled: true
      }
    });

    expect(wrapper.attributes()).toHaveProperty('disabled');
  });

  it('merges variant classes with external class attrs', () => {
    const wrapper = mount(AppButton, {
      props: {
        variant: 'primary',
        size: 'md'
      },
      attrs: {
        class: 'custom-button-class'
      }
    });

    expect(wrapper.classes()).toContain('app-button');
    expect(wrapper.classes()).toContain('app-button-primary');
    expect(wrapper.classes()).toContain('app-button-md');
    expect(wrapper.classes()).toContain('custom-button-class');
    expect(wrapper.attributes('data-slot')).toBe('app-button');
  });

  it('supports icon button frame without forcing icon size', () => {
    const wrapper = mount(AppButton, {
      props: {
        icon: true,
        variant: 'ghost',
        size: 'md'
      },
      slots: {
        default: '<span class="i-mingcute-settings-3-line size-4" aria-hidden="true" />'
      }
    });

    expect(wrapper.attributes('data-icon')).toBe('true');
    expect(wrapper.classes()).toContain('app-button-icon');
    expect(wrapper.classes()).toContain('app-button-md');
    expect(wrapper.find('.size-4').exists()).toBe(true);
  });
});
