import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';

import AppForm from '../../AppForm/AppForm.vue';
import AppSwitch from '../AppSwitch.vue';

describe('AppSwitch', () => {
  it('以 switch 角色呈现当前状态，并把无障碍名称交给根节点', () => {
    const on = mount(AppSwitch, { props: { modelValue: true }, attrs: { 'aria-label': '启用技能 polish' } });
    const off = mount(AppSwitch, { props: { modelValue: false } });

    expect(on.get('[role="switch"]').attributes('aria-checked')).toBe('true');
    expect(on.get('[role="switch"]').attributes('aria-label')).toBe('启用技能 polish');
    expect(off.get('[role="switch"]').attributes('aria-checked')).toBe('false');
  });

  it('点击时请求切换到相反状态，状态由调用方决定', async () => {
    const wrapper = mount(AppSwitch, { props: { modelValue: false } });

    await wrapper.get('[role="switch"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false');
  });

  it('自身或所在表单禁用时不发出切换', async () => {
    const own = mount(AppSwitch, { props: { modelValue: false, disabled: true } });
    const inForm = mount(AppForm, { props: { disabled: true }, slots: { default: () => h(AppSwitch) } });

    await own.get('[role="switch"]').trigger('click');
    await inForm.get('[role="switch"]').trigger('click');

    expect(own.emitted('update:modelValue')).toBeUndefined();
    expect(inForm.getComponent(AppSwitch).emitted('update:modelValue')).toBeUndefined();
    expect(inForm.get('[role="switch"]').attributes('disabled')).toBeDefined();
  });
});
