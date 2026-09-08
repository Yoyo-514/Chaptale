import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWorkbenchStore } from '../store';

beforeEach(() => setActivePinia(createPinia()));
describe('面板导航', () => {
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
  });
  it('Agent 图标从隐藏或其他辅助视图回到 Agent', () => {
    const navigation = useWorkbenchStore();
    navigation.toggleAgent();
    expect(navigation.auxiliaryOpen).toBe(false);
    navigation.toggleAgent();
    expect(navigation.auxiliaryOpen).toBe(true);
    navigation.showAuxiliary('assets');
    navigation.toggleAgent();
    expect(navigation.auxiliary).toBe('agent');
    expect(navigation.auxiliaryOpen).toBe(true);
    navigation.focusMode = true;
    navigation.toggleAgent();
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
