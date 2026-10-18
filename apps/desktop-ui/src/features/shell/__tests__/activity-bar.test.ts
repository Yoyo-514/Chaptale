import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';

import ActivityBar from '../ActivityBar.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('ActivityBar', () => {
  it('保留作品与会话入口，作品导航默认选中', () => {
    const wrapper = mount(ActivityBar);
    const activityButtons = wrapper.get('[aria-label="创作视图"]').findAll('button');
    expect(activityButtons.map(button => button.attributes('aria-label'))).toEqual(['作品', '会话']);
    expect(activityButtons[0]?.attributes('aria-pressed')).toBe('true');
    expect(activityButtons[1]?.attributes('aria-pressed')).toBe('false');
  });

  it('活动栏切换协作栏，选中状态随实际布局变化', async () => {
    const wrapper = mount(ActivityBar);
    const navigation = useWorkbenchStore();
    const button = wrapper.get('button[aria-label="会话"]');
    await button.trigger('click');
    expect(navigation.auxiliaryOpen).toBe(true);
    expect(button.attributes('aria-pressed')).toBe('true');
    await button.trigger('click');
    expect(navigation.auxiliaryOpen).toBe(false);
    expect(button.attributes('aria-pressed')).toBe('false');
  });

  it('从活动栏打开设置', async () => {
    const settingsStore = useSettingsStore();
    const openPanel = vi.spyOn(settingsStore, 'openPanel').mockImplementation(() => undefined);

    const wrapper = mount(ActivityBar);
    await wrapper.get('button[aria-label="打开设置"]').trigger('click');

    expect(wrapper.attributes('aria-label')).toBe('应用活动栏');
    expect(openPanel).toHaveBeenCalled();
  });
});
