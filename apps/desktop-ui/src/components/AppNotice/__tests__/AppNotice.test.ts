import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppNotice from '../AppNotice.vue';

describe('AppNotice', () => {
  it('错误提示使用 alert 角色并带图标', () => {
    const wrapper = mount(AppNotice, { props: { tone: 'error' }, slots: { default: '读取失败' } });
    expect(wrapper.attributes('role')).toBe('alert');
    expect(wrapper.classes()).toContain('app-notice-error');
    expect(wrapper.get('.app-notice-icon').classes()).toContain('i-mingcute-close-circle-line');
    expect(wrapper.text()).toBe('读取失败');
    wrapper.unmount();
  });

  it('普通状态使用 status 角色且没有图标', () => {
    const wrapper = mount(AppNotice, { slots: { default: '正在搜索' } });
    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.find('.app-notice-icon').exists()).toBe(false);
    wrapper.unmount();
  });
});
