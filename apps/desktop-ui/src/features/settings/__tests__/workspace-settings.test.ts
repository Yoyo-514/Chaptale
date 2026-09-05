import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceSettings from '../sections/WorkspaceSettings.vue';
import { useSettingsStore } from '../store';

beforeEach(() => {
  setActivePinia(createPinia());
});

function installState(showInternalFiles = false) {
  const settingsStore = useSettingsStore();
  settingsStore.state = {
    settings: {
      version: 1,
      storage: { mode: 'workspace', workspacePath: 'E:/novel' },
      explorer: { showInternalFiles },
      theme: 'dark'
    },
    paths: {
      effectiveSessionDir: 'E:/novel/.chaptale/sessions'
    }
  } as any;
  return settingsStore;
}

describe('WorkspaceSettings', () => {
  it('shows storage details without owning the workspace picker', () => {
    installState();

    const wrapper = mount(WorkspaceSettings);

    expect(wrapper.text()).toContain('工作区路径');
    expect(wrapper.text()).toContain('E:/novel');
    expect(wrapper.text()).not.toContain('选择工作区');
  });

  it('把「显示内部文件」落盘到设置，而不是留在界面状态里', async () => {
    const settingsStore = installState(false);
    const update = vi.fn(async () => undefined);
    settingsStore.update = update as never;

    const wrapper = mount(WorkspaceSettings);
    await wrapper.getComponent({ name: 'SettingsToggleField' }).vm.$emit('update:modelValue', true);

    expect(update).toHaveBeenCalledWith({ explorer: { showInternalFiles: true } });
  });
});
