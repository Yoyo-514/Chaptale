import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { useCreationStore } from '@/features/creation';
import { useSettingsStore } from '@/features/settings';

import TitleBar from '../TitleBar.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

function mountTitleBar() {
  return mount(TitleBar, { attachTo: document.body });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TitleBar', () => {
  it('renders the creative workbench menus inside the frameless title bar', () => {
    const wrapper = mountTitleBar();

    expect(wrapper.get('[role="menubar"]').attributes('aria-label')).toBe('应用菜单');
    // 菜单项经 reka-ui 渲染为 menuitem；不断言具体 class 名。
    const menuTriggers = wrapper.findAll('[role="menubar"] [role="menuitem"]');
    expect(menuTriggers.map(trigger => trigger.text()).filter(Boolean)).toEqual(['文件', '编辑', '视图', '会话']);
    expect(wrapper.get('.titlebar-document-title').text()).toBe('作品库');
    expect(wrapper.get('.titlebar-leading').attributes('aria-label')).toBe('Chaptale 应用菜单');
  });

  it('键盘打开文件菜单后进入作品库', async () => {
    const creation = useCreationStore();
    const showLibrary = vi.spyOn(creation, 'showLibrary').mockResolvedValue(undefined);
    const wrapper = mountTitleBar();
    const fileTrigger = wrapper.findAll('[role="menubar"] [role="menuitem"]')[0];

    await fileTrigger?.trigger('keydown', { key: 'Enter' });
    await nextTick();

    const openWorkspace = document.body.querySelector<HTMLElement>('[data-item-id="file.library"]');
    expect(openWorkspace?.textContent).toContain('作品库');
    expect(openWorkspace?.hasAttribute('data-disabled')).toBe(false);

    openWorkspace?.click();
    await nextTick();

    expect(showLibrary).toHaveBeenCalledOnce();
  });

  it('从视图菜单的外观子菜单切换主题', async () => {
    const settingsStore = useSettingsStore();
    const setTheme = vi.spyOn(settingsStore, 'setTheme').mockResolvedValue(undefined);
    const wrapper = mountTitleBar();
    const viewTrigger = wrapper.findAll('[role="menubar"] [role="menuitem"]')[2];

    await viewTrigger?.trigger('keydown', { key: 'Enter' });
    await nextTick();

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
