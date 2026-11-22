import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AppUpdate, AppUpdateCheck, ChaptaleDesktopApi } from '@chaptale/desktop/bridge';

import { useNotificationStore } from '@/features/notifications';

import { useAppUpdateStore } from '../help/updates';

const update: AppUpdate = {
  version: '0.2.0',
  notes: '增加快捷键一览。',
  downloadUrl: 'https://github.com/chaptale-test/chaptale/releases/tag/v0.2.0'
};

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  useNotificationStore().closePanel();
  delete window.chaptaleDesktop;
});

function installHelpApi(overrides: Partial<ChaptaleDesktopApi['help']> = {}) {
  const help = {
    getUpdateState: vi.fn().mockResolvedValue({ checkOnStartup: true, available: null }),
    checkUpdate: vi.fn().mockResolvedValue({ kind: 'unpublished' }),
    ...overrides
  };
  window.chaptaleDesktop = { help } as unknown as ChaptaleDesktopApi;
  return help;
}

it('关闭启动检查时只加载已发现的版本，不请求 GitHub', async () => {
  const help = installHelpApi({ getUpdateState: async () => ({ checkOnStartup: false, available: update }) });
  const updates = useAppUpdateStore();
  updates.start();
  await flushPromises();

  expect(updates.available).toEqual(update);
  expect(help.checkUpdate).not.toHaveBeenCalled();
  expect(useNotificationStore().allItems).toEqual([]);
});

it('自动检查发现新版时发一条可查看详情的通知，已提醒过的版本只更新状态', async () => {
  const checkUpdate = vi.fn().mockResolvedValue({ kind: 'available', update, announce: true });
  installHelpApi({ checkUpdate });
  const updates = useAppUpdateStore();
  updates.start();
  updates.start();
  await flushPromises();

  const notifications = useNotificationStore();
  expect(checkUpdate).toHaveBeenCalledOnce();
  expect(notifications.allItems).toMatchObject([{ title: '发现新版本 0.2.0', action: { label: '查看更新' } }]);
  notifications.allItems[0]!.action!.run();
  expect(updates.details).toEqual(update);

  setActivePinia(createPinia());
  checkUpdate.mockResolvedValue({ kind: 'available', update, announce: false });
  useAppUpdateStore().start();
  await flushPromises();
  expect(useAppUpdateStore().available).toEqual(update);
  expect(useNotificationStore().allItems).toEqual([]);
});

it('启动连不上时保持安静，手动检查才显示失败原因', async () => {
  installHelpApi({ checkUpdate: vi.fn().mockRejectedValue(new Error('连不上 GitHub，请检查网络或代理后重试。')) });
  const updates = useAppUpdateStore();
  updates.start();
  await flushPromises();
  expect(useNotificationStore().allItems).toEqual([]);

  await updates.checkNow();
  expect(useNotificationStore().allItems).toMatchObject([
    { kind: 'error', title: '检查更新失败', description: '连不上 GitHub，请检查网络或代理后重试。', inProgress: false }
  ]);
});

it('手动检查接上正在进行的启动查询，在同一条通知里交代结果', async () => {
  const pending = Promise.withResolvers<AppUpdateCheck>();
  const checkUpdate = vi.fn(() => pending.promise);
  installHelpApi({ checkUpdate });
  const updates = useAppUpdateStore();
  updates.start();
  await flushPromises();
  const checking = updates.checkNow();
  const [notice] = useNotificationStore().allItems;
  expect(notice).toMatchObject({ title: '正在检查更新…', inProgress: true });
  expect(checkUpdate).toHaveBeenCalledOnce();

  pending.resolve({ kind: 'available', update, announce: true });
  await checking;
  expect(useNotificationStore().allItems).toMatchObject([
    { id: notice!.id, title: '发现新版本 0.2.0', inProgress: false, action: { label: '查看更新' } }
  ]);
  expect(updates.available).toEqual(update);
});

it.each([
  [{ kind: 'current', version: '0.1.0' }, '已是最新版本 0.1.0'],
  [{ kind: 'unpublished' }, 'GitHub 暂无正式发布']
] as const)('手动查询结果 %o 完成后给出明确提示', async (result, title) => {
  installHelpApi({ checkUpdate: async () => result });
  await useAppUpdateStore().checkNow();
  expect(useNotificationStore().allItems).toMatchObject([{ title, inProgress: false }]);
});
