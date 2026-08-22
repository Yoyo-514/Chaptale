import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { useSettingsStore } from '@/features/settings';
import { useWorkspaceStore } from '@/features/workspace';

import TitleBar from '../TitleBar.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TitleBar', () => {
  it('renders the creative workbench menus inside the frameless title bar', () => {
    const wrapper = mount(TitleBar, { attachTo: document.body });

    expect(wrapper.get('[role="menubar"]').attributes('aria-label')).toBe('应用菜单');
    // 菜单项经 reka-ui 渲染为 menuitem；不断言具体 class 名。
    const menuTriggers = wrapper.findAll('[role="menubar"] [role="menuitem"]');
    expect(menuTriggers.map(trigger => trigger.text()).filter(Boolean)).toEqual([
      '文件',
      '编辑',
      '视图',
      '写作',
      'Agent',
      '审查',
      '帮助'
    ]);
    expect(wrapper.get('.titlebar-document-title').text()).toBe('Chaptale');
    expect(wrapper.get('.titlebar-leading').attributes('aria-label')).toBe('Chaptale 应用菜单');
  });

  it('opens the file menu from the keyboard and delegates workspace selection', async () => {
    const workspaceStore = useWorkspaceStore();
    const openWorkspaceAction = vi.spyOn(workspaceStore, 'openWorkspace').mockResolvedValue(true);
    const wrapper = mount(TitleBar, { attachTo: document.body });
    const fileTrigger = wrapper.findAll('[role="menubar"] [role="menuitem"]')[0];

    await fileTrigger?.trigger('keydown', { key: 'Enter' });
    await nextTick();

    const openWorkspace = document.body.querySelector<HTMLElement>('[data-item-id="file.open-workspace"]');
    expect(openWorkspace?.textContent).toContain('打开工作区');
    expect(openWorkspace?.hasAttribute('data-disabled')).toBe(false);

    openWorkspace?.click();
    await nextTick();

    expect(openWorkspaceAction).toHaveBeenCalledOnce();
  });

  it('从视图菜单的外观子菜单切换主题', async () => {
    const settingsStore = useSettingsStore();
    const setTheme = vi.spyOn(settingsStore, 'setTheme').mockResolvedValue(undefined);
    const wrapper = mount(TitleBar, { attachTo: document.body });
    const viewTrigger = wrapper.findAll('[role="menubar"] [role="menuitem"]')[2];

    await viewTrigger?.trigger('keydown', { key: 'Enter' });
    await nextTick();

    // 视图菜单其余各项都还是占位；外观是这里唯一能用的入口。
    const appearance = document.body.querySelector<HTMLElement>('[data-item-id="view.appearance"]');
    expect(appearance?.textContent).toContain('外观');
    expect(appearance?.hasAttribute('data-disabled')).toBe(false);

    appearance?.click();
    await nextTick();

    document.body.querySelector<HTMLElement>('[data-item-id="view.theme.light"]')?.click();
    await nextTick();

    expect(setTheme).toHaveBeenCalledWith('light');
  });
});
