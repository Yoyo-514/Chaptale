import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it } from 'vitest';

import AppCollapsible from '../AppCollapsible.vue';

describe('AppCollapsible', () => {
  it('renders default title, description and content', () => {
    const wrapper = mount(AppCollapsible, {
      props: {
        modelValue: true,
        title: '高级设置',
        description: '配置超时和网络选项。'
      },
      slots: {
        default: '<div class="advanced-content">内容</div>'
      }
    });

    expect(wrapper.find('[data-slot="app-collapsible"]').classes()).toContain('app-collapsible-card');
    expect(wrapper.find('[data-slot="app-collapsible-trigger"]').text()).toContain('高级设置');
    expect(wrapper.find('[data-slot="app-collapsible-trigger"]').text()).toContain('配置超时和网络选项。');
    expect(wrapper.find('.advanced-content').exists()).toBe(true);
  });

  it('emits v-model updates when the trigger is clicked', async () => {
    const wrapper = mount(AppCollapsible, {
      props: {
        modelValue: false,
        title: '展开'
      }
    });

    await wrapper.find('[data-slot="app-collapsible-trigger"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('supports custom triggers and forwards root attributes', () => {
    const wrapper = mount(AppCollapsible, {
      props: {
        modelValue: true,
        variant: 'plain'
      },
      attrs: {
        id: 'custom-collapsible',
        class: 'custom-root'
      },
      slots: {
        trigger: ({ triggerClass }: { triggerClass: string }) => h('button', { class: triggerClass }, '自定义触发器')
      }
    });

    const root = wrapper.find('[data-slot="app-collapsible"]');
    expect(root.attributes('id')).toBe('custom-collapsible');
    expect(root.classes()).toContain('custom-root');
    expect(root.classes()).toContain('app-collapsible-plain');
    expect(wrapper.find('[data-slot="app-collapsible-trigger"]').text()).toBe('自定义触发器');
  });

  it('disables the trigger', () => {
    const wrapper = mount(AppCollapsible, {
      props: {
        title: '禁用',
        disabled: true
      }
    });

    expect(wrapper.find('[data-slot="app-collapsible-trigger"]').attributes()).toHaveProperty('disabled');
  });
});
