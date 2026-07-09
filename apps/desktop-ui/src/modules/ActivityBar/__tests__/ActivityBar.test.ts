import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/stores/settings';
import ActivityBar from '../index.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('ActivityBar', () => {
  it('opens the settings panel from the activity bar button', async () => {
    const settingsStore = useSettingsStore();
    const openPanel = vi.spyOn(settingsStore, 'openPanel').mockImplementation(() => undefined);

    const wrapper = mount(ActivityBar);
    await wrapper.get('button[aria-label="打开设置"]').trigger('click');

    expect(wrapper.attributes('aria-label')).toBe('应用活动栏');
    expect(openPanel).toHaveBeenCalled();
  });
});
