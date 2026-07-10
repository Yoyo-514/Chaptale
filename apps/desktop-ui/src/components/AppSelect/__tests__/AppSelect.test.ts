import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it } from 'vitest';

import AppFormField from '../../AppForm/AppFormField.vue';
import AppSelect from '../AppSelect.vue';

describe('AppSelect', () => {
  it('forwards trigger attributes and merges classes', () => {
    const wrapper = mount(AppSelect, {
      props: {
        modelValue: 'openai',
        required: true,
        name: 'provider'
      },
      attrs: {
        id: 'provider',
        class: 'custom-select',
        'aria-describedby': 'provider-description'
      }
    });
    const trigger = wrapper.find('[data-slot="app-select"]');

    expect(trigger.classes()).toContain('app-select-trigger');
    expect(trigger.classes()).toContain('custom-select');
    expect(trigger.attributes('id')).toBe('provider');
    expect(trigger.attributes('aria-required')).toBe('true');
    expect(trigger.attributes('aria-describedby')).toBe('provider-description');
  });

  it('works directly with AppFormField control attributes', () => {
    const wrapper = mount(AppFormField, {
      props: {
        controlId: 'api-type',
        label: 'API 类型',
        description: '选择兼容的接口协议',
        required: true,
        error: '请选择 API 类型'
      },
      slots: {
        default: ({ controlAttrs }: { controlAttrs: Record<string, unknown> }) =>
          h(AppSelect, { ...controlAttrs, modelValue: 'openai' })
      }
    });
    const trigger = wrapper.find('[data-slot="app-select"]');

    expect(trigger.attributes('id')).toBe('api-type');
    expect(trigger.attributes('aria-required')).toBe('true');
    expect(trigger.attributes('aria-invalid')).toBe('true');
    expect(trigger.attributes('aria-describedby')).toBe('api-type-description api-type-error');
    expect(trigger.attributes('data-invalid')).toBe('true');
  });

  it('forwards form field attributes through a custom trigger', () => {
    const wrapper = mount(AppSelect, {
      attrs: {
        id: 'custom-select',
        'aria-describedby': 'custom-select-description'
      },
      slots: {
        trigger: ({ triggerClass }: { triggerClass: string }) => h('button', { class: triggerClass }, '选择')
      }
    });
    const trigger = wrapper.find('[data-slot="app-select"]');

    expect(trigger.element.tagName).toBe('BUTTON');
    expect(trigger.attributes('id')).toBe('custom-select');
    expect(trigger.attributes('aria-describedby')).toBe('custom-select-description');
  });
});
