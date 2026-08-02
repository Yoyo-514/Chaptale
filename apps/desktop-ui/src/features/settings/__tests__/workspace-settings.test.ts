import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import WorkspaceSettings from '../sections/WorkspaceSettings.vue';
import { useSettingsStore } from '../store';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('WorkspaceSettings', () => {
  it('shows storage details without owning the workspace picker', () => {
    const settingsStore = useSettingsStore();
    settingsStore.state = {
      settings: {
        version: 1,
        storage: { mode: 'workspace', workspacePath: 'E:/novel' }
      },
      paths: {
        effectiveSessionDir: 'E:/novel/.chaptale/sessions'
      }
    } as any;

    const wrapper = mount(WorkspaceSettings);

    expect(wrapper.text()).toContain('工作区路径');
    expect(wrapper.text()).toContain('E:/novel');
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['使用 Global']);
    expect(wrapper.text()).not.toContain('选择工作区');
  });
});
