import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/features/agent';

import { useWorkbenchStore } from '../store';

beforeEach(() => setActivePinia(createPinia()));
describe('面板导航', () => {
  it('侧栏开关；专注模式下点击退出专注并保持打开', () => {
    const navigation = useWorkbenchStore();
    navigation.toggleSidebar();
    expect(navigation.sidebarOpen).toBe(false);
    navigation.toggleSidebar();
    expect(navigation.sidebarOpen).toBe(true);
    navigation.focusMode = true;
    navigation.toggleSidebar();
    expect(navigation.sidebarOpen).toBe(true);
    expect(navigation.focusMode).toBe(false);
  });
  it('协作栏开关回到会话页，专注模式下点击退出专注', () => {
    const navigation = useWorkbenchStore();
    navigation.toggleAuxiliary();
    expect(navigation.auxiliaryOpen).toBe(true);
    navigation.agentView = 'history';
    navigation.toggleAuxiliary();
    expect(navigation.auxiliaryOpen).toBe(false);
    navigation.toggleAuxiliary();
    expect(navigation.agentView).toBe('chat');
    navigation.focusMode = true;
    navigation.toggleAuxiliary();
    expect(navigation.auxiliaryOpen).toBe(true);
    expect(navigation.focusMode).toBe(false);
  });
  it('讨论请求写进新会话草稿并打开协作栏，不自动发送', () => {
    const navigation = useWorkbenchStore();
    navigation.askAgent('C:/work', '讨论选段', ['正文/第一章.md']);
    expect(useAgentStore().draft).toBe('讨论选段\n文件：正文/第一章.md');
    expect(useAgentStore().composeCwd).toBe('C:/work');
    expect(navigation.auxiliaryOpen).toBe(true);
  });
});
