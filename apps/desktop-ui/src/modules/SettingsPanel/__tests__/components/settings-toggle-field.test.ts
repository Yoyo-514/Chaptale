import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { AppCheckbox } from '@/components/AppCheckbox';

import SettingsToggleField from '../../components/SettingsToggleField.vue';

describe('SettingsToggleField', () => {
  it('renders title and description with an associated checkbox', () => {
    const wrapper = mount(SettingsToggleField, {
      props: {
        modelValue: false,
        title: 'GitHub 克隆',
        description: '读取真实仓库文件。'
      }
    });
    const checkbox = wrapper.find('[data-slot="app-checkbox"]');

    expect(wrapper.text()).toContain('GitHub 克隆');
    expect(wrapper.text()).toContain('读取真实仓库文件。');
    expect(wrapper.find('label').attributes('for')).toBe(checkbox.attributes('id'));
  });

  it('emits boolean updates from AppCheckbox', () => {
    const wrapper = mount(SettingsToggleField, {
      props: {
        modelValue: false,
        title: '启用'
      }
    });

    wrapper.findComponent(AppCheckbox).vm.$emit('update:modelValue', true);

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('renders nested content only while enabled and supports layout options', async () => {
    const wrapper = mount(SettingsToggleField, {
      props: {
        modelValue: false,
        title: '视频理解',
        wide: true,
        contentColumns: 1
      },
      slots: {
        default: '<input class="nested-control" />'
      }
    });

    expect(wrapper.classes()).toContain('is-wide');
    expect(wrapper.find('.nested-control').exists()).toBe(false);

    await wrapper.setProps({ modelValue: true });
    expect(wrapper.find('.nested-control').exists()).toBe(true);
    expect(wrapper.find('[data-slot="settings-toggle-field-content"]').classes()).toContain(
      'settings-toggle-field-content-1'
    );
  });
});
