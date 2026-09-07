import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import AppForm from '../../AppForm/AppForm.vue';
import AppCombobox from '../AppCombobox.vue';

const options = [
  { value: '[[角色/林晚.md]]', label: '林晚', description: '角色/林晚.md' },
  { value: '[[角色/沈舟.md]]', label: '沈舟', description: '角色/沈舟.md' }
];
let wrapper: VueWrapper;
afterEach(() => wrapper?.unmount());

function mountControlled(initial = '') {
  const value = ref(initial);
  wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(AppCombobox, {
          modelValue: value.value,
          options,
          'aria-label': '目标来源',
          'onUpdate:modelValue': next => {
            value.value = next;
          }
        })
    }),
    { attachTo: document.body }
  );
  return value;
}

describe('AppCombobox', () => {
  it('保留手输的新链接，不在失焦时丢弃', async () => {
    const value = mountControlled();
    const input = wrapper.get('input');
    await input.setValue('[[未创建的来源]]');
    await input.trigger('blur');
    await flushPromises();
    expect(value.value).toBe('[[未创建的来源]]');
    expect((input.element as HTMLInputElement).value).toBe(value.value);
  });

  it('按中文名称筛选并从真实 Portal 选项选择链接', async () => {
    const value = mountControlled();
    await wrapper.get('input').setValue('沈');
    await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(1));
    expect(document.querySelector('[role="option"]')?.textContent).toContain('沈舟');
    (document.querySelector('[role="option"]') as HTMLElement).click();
    await vi.waitFor(() => expect(value.value).toBe('[[角色/沈舟.md]]'));
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe(value.value);
  });

  it('空查询支持方向键与 Enter 选择', async () => {
    const value = mountControlled();
    await wrapper.get('button').trigger('click');
    await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(2));
    await wrapper.get('input').trigger('keydown', { key: 'ArrowDown' });
    await wrapper.get('input').trigger('keydown', { key: 'Enter' });
    await vi.waitFor(() => expect(options.map(option => option.value)).toContain(value.value));
  });

  it('继承表单禁用状态并将错误与标签属性传到输入框', () => {
    wrapper = mount(AppForm, {
      props: { disabled: true },
      slots: {
        default: () =>
          h(AppCombobox, {
            options,
            invalid: true,
            id: 'source',
            'aria-label': '来源',
            class: 'custom-source'
          })
      }
    });
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('input').attributes('id')).toBe('source');
    expect(wrapper.get('[data-slot="app-combobox"]').classes()).toContain('custom-source');
  });
});
