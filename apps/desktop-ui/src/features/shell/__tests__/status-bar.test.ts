import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ScheduledBackupState } from '@chaptale/desktop/bridge';

import { useCloudSyncStore, useScheduledBackupStore } from '@/features/cloud-sync';
import { useCreationStore } from '@/features/creation';
import { useNotificationStore } from '@/features/notifications';
import { useSettingsStore } from '@/features/settings';

import StatusBar from '../StatusBar.vue';

const connectedAt = '2026-11-21T01:43:00Z';
const backupWork = vi.fn().mockResolvedValue({ ok: true, uploads: [{ provider: 'onedrive', result: { ok: true } }] });
const backupNow = vi.fn();
const pickBackup = vi.fn();
let wrapper: VueWrapper;

function backupState(patch: Partial<ScheduledBackupState> = {}): ScheduledBackupState {
  return {
    settings: { enabled: true, directory: 'D:/备份', intervalMinutes: 30 },
    lastBackupAt: null,
    folderError: null,
    failures: [],
    ...patch
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  window.chaptaleDesktop = {
    settings: { getState: async () => ({ settings: { theme: 'light', editor: { autoSave: false } } }) },
    cloudSync: { backupWork },
    scheduledBackup: { backupNow, pickBackup }
  } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  useCloudSyncStore().state = { accounts: [], authorizing: null, availability: [] };
  useScheduledBackupStore().state = backupState({ settings: { enabled: false, directory: null, intervalMinutes: 30 } });
  useCreationStore().connected = true;
  wrapper = mount(StatusBar, { attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  delete window.chaptaleDesktop;
});

/** 打开左下角的“备份”菜单，返回菜单项。 */
async function openMenu() {
  await wrapper
    .findAll('button')
    .find(button => button.text() === '备份')!
    .trigger('keydown', { key: 'Enter' });
  await flushPromises();
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}
const labels = (items: HTMLElement[]) => items.map(item => item.textContent?.trim());

it('没有登录云端账户时不列上传项；备份设置和云端账户分别打开对应分区', async () => {
  let items = await openMenu();
  expect(labels(items)).toEqual([
    '立即备份',
    '打开备份文件夹',
    '从云端恢复…',
    '从本机备份恢复…',
    '备份设置…',
    '云端账户…'
  ]);
  expect(items[1]!.getAttribute('aria-disabled')).toBe('true');

  items[4]!.click();
  await flushPromises();
  expect(useSettingsStore().activeSection).toBe('backup');

  items = await openMenu();
  items[5]!.click();
  await flushPromises();
  expect(useSettingsStore().isOpen).toBe(true);
  expect(useSettingsStore().activeSection).toBe('cloudSync');
});

it('立即备份把结果写进同一条通知；没选文件夹时取消选择不留通知', async () => {
  backupNow.mockResolvedValueOnce(null);
  (await openMenu())[0]!.click();
  await flushPromises();
  expect(backupNow).toHaveBeenCalledTimes(1);
  expect(useNotificationStore().items).toEqual([]);

  useScheduledBackupStore().state = backupState();
  backupNow.mockResolvedValueOnce({
    saved: 1,
    failures: [{ title: 'Dropbox 定时备份失败', message: '网络不可用' }]
  });
  (await openMenu())[0]!.click();
  await flushPromises();
  expect(useNotificationStore().items).toMatchObject([
    { kind: 'error', title: '已在本机备份 1 部作品，部分备份失败', description: 'Dropbox 定时备份失败：网络不可用' }
  ]);
});

it('从本机备份恢复时取消选择，停留在当前界面', async () => {
  pickBackup.mockResolvedValueOnce(null);
  const creation = useCreationStore();
  const showLibrary = vi.spyOn(creation, 'showLibrary');
  (await openMenu())[3]!.click();
  await flushPromises();
  expect(showLibrary).not.toHaveBeenCalled();
});

it('两家都登录时平铺上传目标；选一家就把当前作品上传到那一家', async () => {
  useCloudSyncStore().state!.accounts = [
    { provider: 'dropbox', displayName: '作者', connectedAt },
    { provider: 'onedrive', displayName: '作者', connectedAt }
  ];
  const creation = useCreationStore();
  creation.works = [{ id: 'w1', title: '雨夜', kind: 'novel', createdAt: 1, updatedAt: 2 }];
  creation.state.activeWorkId = 'w1';
  creation.libraryOpen = false;
  await flushPromises();

  const items = await openMenu();
  expect(labels(items).slice(2, 5)).toEqual([
    '上传《雨夜》到 Dropbox',
    '上传《雨夜》到 OneDrive',
    '上传《雨夜》到全部云端账户'
  ]);

  items[3]!.click();
  await flushPromises();

  expect(backupWork).toHaveBeenCalledExactlyOnceWith({ workId: 'w1', target: 'onedrive' }, expect.any(Function));
});

it('没有打开作品时，上传当前作品的菜单项不可用', async () => {
  useCloudSyncStore().state!.accounts = [{ provider: 'dropbox', displayName: '作者', connectedAt }];
  await flushPromises();

  const upload = (await openMenu())[2]!;

  expect(upload.textContent?.trim()).toBe('上传当前作品到 Dropbox');
  expect(upload.getAttribute('aria-disabled')).toBe('true');
});
