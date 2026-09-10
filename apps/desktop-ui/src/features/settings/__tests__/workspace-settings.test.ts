import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '@/features/workspace';

import WorkspaceSettings from '../sections/WorkspaceSettings.vue';
import { useSettingsStore } from '../store';

beforeEach(() => {
  setActivePinia(createPinia());
});

function installState(showInternalFiles = false, workspacePath = 'E:/novel') {
  const settingsStore = useSettingsStore();
  settingsStore.state = {
    settings: {
      version: 1,
      workspace: workspacePath ? { path: workspacePath } : {},
      explorer: { showInternalFiles },
      theme: 'dark'
    },
    paths: {
      effectiveSessionDir: workspacePath ? 'E:/chaptale/sessions/novel' : '',
      currentCwd: workspacePath
    }
  } as any;
  return settingsStore;
}

describe('WorkspaceSettings', () => {
  it('shows which work the sessions belong to', () => {
    installState();

    const wrapper = mount(WorkspaceSettings);

    expect(wrapper.text()).toContain('当前作品');
    expect(wrapper.text()).toContain('E:/novel');
    expect(wrapper.text()).toContain('E:/chaptale/sessions/novel');
  });

  it('打开作品…走作品生命周期，而不是自己选目录', async () => {
    installState(false, '');
    const workspaceStore = useWorkspaceStore();
    const openWorkspace = vi.fn(async () => true);
    workspaceStore.openWorkspace = openWorkspace as never;

    const wrapper = mount(WorkspaceSettings);
    await wrapper.get('button').trigger('click');

    expect(openWorkspace).toHaveBeenCalledOnce();
  });

  it('says so plainly when no work is open instead of offering a storage mode', () => {
    installState(false, '');

    const wrapper = mount(WorkspaceSettings);

    expect(wrapper.text()).toContain('未打开作品');
    expect(wrapper.text()).toContain('尚未打开作品');
    // 「关闭作品」只在有作品可关时出现。
    expect(wrapper.text()).not.toContain('关闭作品');
    expect(wrapper.text()).not.toContain('Global');
  });

  it('关闭作品同样走作品生命周期，而不是自己改设置', async () => {
    installState();
    const workspaceStore = useWorkspaceStore();
    const closeWorkspace = vi.fn(async () => true);
    workspaceStore.closeWorkspace = closeWorkspace as never;

    const wrapper = mount(WorkspaceSettings);
    const closeButton = wrapper.findAll('button').find(button => button.text().includes('关闭作品'));

    await closeButton!.trigger('click');

    expect(closeWorkspace).toHaveBeenCalledOnce();
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
