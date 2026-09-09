import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWorkbenchStore } from '../store';

beforeEach(() => setActivePinia(createPinia()));
describe('面板导航', () => {
  it('工作视图去重，关闭回到正文，切换作品后清空', () => {
    const navigation = useWorkbenchStore();
    navigation.openView('library');
    navigation.openView('timeline');
    navigation.openView('library');
    expect(navigation.viewTabs).toEqual(['library', 'timeline']);
    expect(navigation.center).toBe('library');
    navigation.closeView('timeline');
    expect(navigation.center).toBe('library');
    navigation.closeView('library');
    expect(navigation.center).toBe('editor');
    navigation.openView('relationships');
    navigation.resetViews();
    expect(navigation.viewTabs).toEqual([]);
    expect(navigation.center).toBe('editor');
  });
  it('重复点击关闭主侧栏，换视图重新打开', () => {
    const navigation = useWorkbenchStore();
    navigation.toggleSidebar('workspace');
    expect(navigation.sidebarOpen).toBe(false);
    navigation.toggleSidebar('structure');
    expect(navigation.sidebarOpen).toBe(true);
    expect(navigation.sidebar).toBe('structure');
    navigation.toggleSidebar('structure');
    expect(navigation.sidebarOpen).toBe(false);
    navigation.showSidebar('structure');
    expect(navigation.sidebarOpen).toBe(true);
    navigation.focusMode = true;
    navigation.toggleSidebar('structure');
    expect(navigation.sidebarOpen).toBe(true);
    expect(navigation.focusMode).toBe(false);
  });
  it('辅助栏图标收起当前视图，重开保留视图', () => {
    const navigation = useWorkbenchStore();
    navigation.toggleAuxiliary();
    expect(navigation.auxiliaryOpen).toBe(false);
    navigation.toggleAuxiliary();
    expect(navigation.auxiliaryOpen).toBe(true);
    navigation.showAuxiliary('assets');
    navigation.toggleAuxiliary();
    expect(navigation.auxiliary).toBe('assets');
    expect(navigation.auxiliaryOpen).toBe(false);
    navigation.toggleAuxiliary();
    expect(navigation.auxiliary).toBe('assets');
    expect(navigation.auxiliaryOpen).toBe(true);
    navigation.focusMode = true;
    navigation.toggleAuxiliary();
    expect(navigation.focusMode).toBe(false);
  });
  it('讨论请求只进入待确认队列，并打开面板', () => {
    const navigation = useWorkbenchStore();
    navigation.auxiliaryOpen = false;
    navigation.askAgent('C:/work', '讨论选段', []);
    expect(navigation.agentRequests).toMatchObject([{ rootPath: 'C:/work', prompt: '讨论选段', files: [] }]);
    expect(navigation.auxiliaryOpen).toBe(true);
  });
});
