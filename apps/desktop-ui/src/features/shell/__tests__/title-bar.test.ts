import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

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
});
