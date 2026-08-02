import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/features/settings';

import ActivityBar from '../ActivityBar.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('ActivityBar', () => {
  it('shows the creative workbench activities with workspace selected', () => {
    const wrapper = mount(ActivityBar);
    const activityButtons = wrapper.get('[aria-label="创作视图"]').findAll('button');

    expect(activityButtons.map(button => button.attributes('aria-label'))).toEqual([
      '工作区',
      '搜索',
      '结构',
      '审查',
      '记忆'
    ]);
    expect(activityButtons[0]?.attributes('aria-current')).toBe('page');
    expect(activityButtons.slice(1).every(button => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('opens the settings panel from the activity bar button', async () => {
    const settingsStore = useSettingsStore();
    const openPanel = vi.spyOn(settingsStore, 'openPanel').mockImplementation(() => undefined);

    const wrapper = mount(ActivityBar);
    await wrapper.get('button[aria-label="打开设置"]').trigger('click');

    expect(wrapper.attributes('aria-label')).toBe('应用活动栏');
    expect(openPanel).toHaveBeenCalled();
  });
});
