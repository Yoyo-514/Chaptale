import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/features/notifications';
import { useSettingsStore } from '@/features/settings';

import { useWorkspaceStore } from '../store';

function createSettingsState(workspacePath = 'E:/workspace-b') {
  return {
    settings: { version: 1, workspace: { path: workspacePath }, theme: 'light' },
    paths: { rootDir: 'root', settingsPath: 'settings.json', currentCwd: workspacePath }
  };
}

function installDesktopApi(state = createSettingsState()) {
  const api = {
    workspace: {
      getState: vi.fn().mockResolvedValue({
        rootPath: state.paths.currentCwd,
        displayName: 'workspace-b',
        hasChaptaleMetadata: false
      })
    },
    settings: {
      selectWorkspaceDir: vi.fn().mockResolvedValue({ canceled: false, state }),
      update: vi.fn().mockResolvedValue(state)
    }
  };
  window.chaptaleDesktop = api as any;
  return api;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  delete window.chaptaleDesktop;
});

describe('workspace store', () => {
  it('打开作品后同步设置快照与作品状态', async () => {
    const state = createSettingsState();
    const api = installDesktopApi(state);
    const workspaceStore = useWorkspaceStore();

    await expect(workspaceStore.openWorkspace()).resolves.toBe(true);

    expect(api.settings.selectWorkspaceDir).toHaveBeenCalledOnce();
    expect(useSettingsStore().state).toStrictEqual(state);
    expect(workspaceStore.rootPath).toBe(state.paths.currentCwd);
    expect(workspaceStore.displayName).toBe('workspace-b');
    expect(workspaceStore.revision).toBe(1);
    expect(workspaceStore.isOpening).toBe(false);
  });

  it('取消选择目录不改变任何状态', async () => {
    const api = installDesktopApi();
    api.settings.selectWorkspaceDir.mockResolvedValue({ canceled: true });
    const workspaceStore = useWorkspaceStore();

    await expect(workspaceStore.openWorkspace()).resolves.toBe(false);

    expect(useSettingsStore().state).toBeUndefined();
    expect(api.workspace.getState).not.toHaveBeenCalled();
    expect(workspaceStore.error).toBe('');
  });

  it('读取作品状态失败时提示作者', async () => {
    const api = installDesktopApi();
    api.workspace.getState.mockRejectedValue(new Error('read failed'));
    const workspaceStore = useWorkspaceStore();

    await expect(workspaceStore.openWorkspace()).resolves.toBe(false);

    expect(workspaceStore.error).toBe('read failed');
    expect(useNotificationStore().items.at(-1)).toMatchObject({
      kind: 'error',
      title: '打开作品失败',
      description: 'read failed'
    });
  });
});
