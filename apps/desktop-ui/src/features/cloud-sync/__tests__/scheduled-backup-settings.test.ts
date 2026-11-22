import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, it, vi } from 'vitest';

import type { ScheduledBackupEvent, ScheduledBackupState } from '@chaptale/desktop/bridge';

import { useNotificationStore } from '@/features/notifications';

import { useScheduledBackupStore } from '../scheduled-backup-store';
import ScheduledBackupSettings from '../ScheduledBackupSettings.vue';

type ScheduledBackupApi = NonNullable<typeof window.chaptaleDesktop>['scheduledBackup'];

const closed: ScheduledBackupState = {
  settings: { enabled: false, directory: null, intervalMinutes: 30 },
  lastBackupAt: null,
  folderError: null,
  failures: []
};

let emit: (event: ScheduledBackupEvent) => void;

function installApi(overrides: Partial<ScheduledBackupApi> = {}) {
  const api: ScheduledBackupApi = {
    getState: vi.fn().mockResolvedValue(closed),
    update: vi.fn(),
    chooseDirectory: vi.fn(),
    openDirectory: vi.fn().mockResolvedValue(undefined),
    backupNow: vi.fn(),
    pickBackup: vi.fn(),
    subscribe: vi.fn(listener => {
      emit = listener;
      return () => {};
    }),
    ...overrides
  };
  window.chaptaleDesktop = { scheduledBackup: api } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  return api;
}

beforeEach(() => setActivePinia(createPinia()));

it('打开开关后显示选好的备份文件夹；取消选择时开关保持关闭', async () => {
  const opened: ScheduledBackupState = {
    ...closed,
    settings: { enabled: true, directory: 'D:/文档/Chaptale 备份', intervalMinutes: 30 }
  };
  const api = installApi({ update: vi.fn().mockResolvedValueOnce(closed).mockResolvedValueOnce(opened) });
  const wrapper = mount(ScheduledBackupSettings, { attachTo: document.body });
  await flushPromises();
  expect(wrapper.text()).toContain('尚未选择');
  expect(wrapper.text()).toContain('还没有备份');
  const open = wrapper.findAll('button').find(button => button.text() === '打开文件夹')!;
  expect(open.attributes('disabled')).toBeDefined();

  const toggle = wrapper.get('[role="switch"]');
  await toggle.trigger('click');
  await flushPromises();
  expect(api.update).toHaveBeenLastCalledWith({ enabled: true });
  expect(toggle.attributes('aria-checked')).toBe('false');

  await toggle.trigger('click');
  await flushPromises();
  expect(toggle.attributes('aria-checked')).toBe('true');
  expect(wrapper.text()).toContain('D:/文档/Chaptale 备份');
  wrapper.unmount();
});

it('文件夹不可用时在分区里说明原因；改选文件夹的报错也显示出来', async () => {
  installApi({
    getState: vi.fn().mockResolvedValue({
      settings: { enabled: true, directory: 'E:/备份', intervalMinutes: 10 },
      lastBackupAt: null,
      folderError: '找不到备份文件夹。请接回存储设备，或更换备份位置。',
      failures: []
    }),
    chooseDirectory: vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Error invoking remote method 'scheduled-backup:choose-directory': Error: 备份文件夹不能放在应用数据文件夹里"
        )
      )
  });
  const wrapper = mount(ScheduledBackupSettings, { attachTo: document.body });
  await flushPromises();
  expect(wrapper.text()).toContain('找不到备份文件夹');

  const choose = wrapper.findAll('button').find(button => button.text() === '更换文件夹')!;
  await choose.trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('备份文件夹不能放在应用数据文件夹里');
  expect(wrapper.text()).not.toContain('Error invoking');
  wrapper.unmount();
});

it('主进程报告的备份失败进入通知中心，状态变化时重新读取', async () => {
  const api = installApi();
  useScheduledBackupStore().connect();
  useScheduledBackupStore().connect();
  expect(api.subscribe).toHaveBeenCalledTimes(1);

  emit({ kind: 'failed', title: 'Dropbox 定时备份失败', message: '网络不可用' });
  expect(useNotificationStore().items).toMatchObject([
    { kind: 'error', title: 'Dropbox 定时备份失败', description: '网络不可用' }
  ]);

  await flushPromises();
  emit({ kind: 'changed' });
  await flushPromises();
  expect(api.getState).toHaveBeenCalledTimes(2);
  expect(useScheduledBackupStore().state).toEqual(closed);
});
