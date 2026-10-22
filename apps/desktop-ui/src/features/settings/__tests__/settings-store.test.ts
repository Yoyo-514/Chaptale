import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/features/notifications';

import { useSettingsStore } from '../store';

function createSettingsState(theme = 'light') {
  return {
    settings: { version: 1, editor: { autoSave: false }, theme },
    paths: { rootDir: 'root', settingsPath: 'settings.json' }
  };
}

function installDesktopApi() {
  const api = {
    settings: {
      getState: vi.fn().mockResolvedValue(createSettingsState()),
      update: vi.fn().mockResolvedValue(createSettingsState('dark')),
      openConfigDir: vi.fn().mockResolvedValue(undefined)
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

describe('settings store', () => {
  it('打开面板时定位分区并读取设置', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();

    store.openPanel('files');
    expect(store.isOpen).toBe(true);
    expect(store.activeSection).toBe('files');
    await vi.waitFor(() => expect(store.state).toEqual(createSettingsState()));
    expect(store.isLoading).toBe(false);

    store.setSection('llm');
    expect(store.activeSection).toBe('llm');
    store.closePanel();
    expect(store.isOpen).toBe(false);
    expect(api.settings.getState).toHaveBeenCalledOnce();
  });

  it('保存失败时保留原快照并通知作者', async () => {
    const api = installDesktopApi();
    api.settings.update.mockRejectedValue(new Error('save failed'));
    const store = useSettingsStore();
    const notifications = useNotificationStore();
    const before = createSettingsState();
    store.state = before as any;

    await expect(store.update({ theme: 'dark' })).resolves.toBe(false);

    expect(store.state).toStrictEqual(before);
    expect(store.error).toBe('save failed');
    expect(notifications.items.at(-1)).toMatchObject({
      kind: 'error',
      title: '更新设置失败',
      description: 'save failed'
    });
  });

  it('打开应用配置目录', async () => {
    const api = installDesktopApi();
    await useSettingsStore().openConfigDir();
    expect(api.settings.openConfigDir).toHaveBeenCalledOnce();
  });
});
