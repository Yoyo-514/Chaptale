import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useCloudSyncStore } from '@/features/cloud-sync';
import { useCreationStore } from '@/features/creation';
import { useSettingsStore } from '@/features/settings';

import StatusBar from '../StatusBar.vue';

const connectedAt = '2026-11-21T01:43:00Z';
const backupWork = vi.fn().mockResolvedValue({ ok: true, uploads: [{ provider: 'onedrive', result: { ok: true } }] });
let wrapper: VueWrapper;

beforeEach(() => {
  setActivePinia(createPinia());
  window.chaptaleDesktop = {
    settings: { getState: async () => ({ settings: { theme: 'light', editor: { autoSave: false } } }) },
    cloudSync: { backupWork }
  } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  useCloudSyncStore().state = { accounts: [], authorizing: null, availability: [] };
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

it('没有登录云端账户时，备份菜单只有恢复和账户入口；账户入口打开设置', async () => {
  const items = await openMenu();
  expect(labels(items)).toEqual(['从云端恢复…', '云端账户…']);

  items[1]!.click();
  await flushPromises();

  expect(useSettingsStore().isOpen).toBe(true);
  expect(useSettingsStore().activeSection).toBe('cloudSync');
});

it('两家都登录时平铺备份目标；选一家就把当前作品备份到那一家', async () => {
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
  expect(labels(items)).toEqual([
    '备份到 Dropbox',
    '备份到 OneDrive',
    '备份到全部云端账户',
    '从云端恢复…',
    '云端账户…'
  ]);

  items[1]!.click();
  await flushPromises();

  expect(backupWork).toHaveBeenCalledExactlyOnceWith({ workId: 'w1', target: 'onedrive' }, expect.any(Function));
});

it('没有打开作品时，备份当前作品的菜单项不可用', async () => {
  useCloudSyncStore().state!.accounts = [{ provider: 'dropbox', displayName: '作者', connectedAt }];
  await flushPromises();

  const [backup] = await openMenu();

  expect(backup!.textContent?.trim()).toBe('备份到 Dropbox');
  expect(backup!.getAttribute('aria-disabled')).toBe('true');
});
