import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppTagInput from '../AppTagInput.vue';

function setup(modelValue: string[]) {
  return mount(AppTagInput, { props: { modelValue, label: '别名' } });
}

describe('AppTagInput', () => {
  it('回车添加去掉首尾空白的新值，重复值不添加', async () => {
    const wrapper = setup(['小林']);
    const input = wrapper.find('input');
    await input.setValue(' 阿晚 ');
    await input.trigger('keydown', { key: 'Enter' });
    await input.setValue('小林');
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')).toEqual([[['小林', '阿晚']]]);
  });

  it('输入法组合中的回车不提交', async () => {
    const wrapper = setup([]);
    const input = wrapper.find('input');
    await input.setValue('xiao');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('点移除按钮或在空输入框按退格删除标签', async () => {
    const wrapper = setup(['小林', '阿晚']);
    await wrapper.get('button[aria-label="移除别名小林"]').trigger('click');
    await wrapper.find('input').trigger('keydown', { key: 'Backspace' });
    expect(wrapper.emitted('update:modelValue')).toEqual([[['阿晚']], [['小林']]]);
  });
});
