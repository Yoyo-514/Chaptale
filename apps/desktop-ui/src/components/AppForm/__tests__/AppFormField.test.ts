import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';

import AppFormField from '../AppFormField.vue';

describe('AppFormField', () => {
  it('associates label, description and error with the control', () => {
    const wrapper = mount(AppFormField, {
      props: {
        controlId: 'provider-id',
        label: '供应商 ID',
        description: '只能包含字母、数字和连字符',
        error: '供应商 ID 已存在',
        required: true
      },
      slots: {
        default: ({ controlAttrs }: { controlAttrs: Record<string, unknown> }) => h('input', controlAttrs)
      }
    });

    const input = wrapper.find('input');
    expect(wrapper.find('label').attributes('for')).toBe('provider-id');
    expect(input.attributes('id')).toBe('provider-id');
    expect(input.attributes('required')).toBeDefined();
    expect(input.attributes('aria-required')).toBe('true');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe('provider-id-description provider-id-error');
    expect(wrapper.find('#provider-id-description').text()).toBe('只能包含字母、数字和连字符');
    expect(wrapper.find('#provider-id-error').text()).toBe('供应商 ID 已存在');
    expect(wrapper.find('#provider-id-error').attributes('role')).toBe('alert');
  });

  it('generates a control id when one is not provided', () => {
    const wrapper = mount(AppFormField, {
      props: {
        label: '显示名称'
      },
      slots: {
        default: ({ controlAttrs }: { controlAttrs: Record<string, unknown> }) => h('input', controlAttrs)
      }
    });

    const controlId = wrapper.find('input').attributes('id');
    expect(controlId).toMatch(/^app-form-control-/);
    expect(wrapper.find('label').attributes('for')).toBe(controlId);
  });

  it('supports layout and grid span classes', () => {
    const wrapper = mount(AppFormField, {
      props: {
        layout: 'inline',
        span: 'full'
      }
    });

    expect(wrapper.classes()).toContain('app-form-field-inline');
    expect(wrapper.classes()).toContain('app-form-field-span-full');
    expect(wrapper.attributes('data-slot')).toBe('app-form-field');
  });
});
