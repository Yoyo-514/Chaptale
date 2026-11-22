import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import CloudRestoreDialog from '../components/CloudRestoreDialog.vue';
import { useCloudSyncStore } from '../store';

type CloudSyncApi = NonNullable<typeof window.chaptaleDesktop>['cloudSync'];

const name = '雨夜_2026-11-21_0143.chaptale';
const downloadedPath = 'C:/Temp/chaptale-restore-1/backup.chaptale';
let wrapper: VueWrapper;
let api: Pick<CloudSyncApi, 'downloadBackup' | 'deleteBackup' | 'discardDownload'>;

beforeEach(async () => {
  setActivePinia(createPinia());
  api = {
    downloadBackup: vi.fn().mockResolvedValue({ ok: true, path: downloadedPath }),
    deleteBackup: vi.fn().mockResolvedValue({ ok: true }),
    discardDownload: vi.fn().mockResolvedValue(undefined)
  };
  window.chaptaleDesktop = { cloudSync: api } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  const store = useCloudSyncStore();
  store.backups = [{ provider: 'dropbox', id: `/${name}`, name, size: 2048 }];
  store.restoreOpen = true;
  wrapper = mount(CloudRestoreDialog, { attachTo: document.body });
  await flushPromises();
});
afterEach(() => {
  wrapper.unmount();
  delete window.chaptaleDesktop;
});

const button = (label: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

it('列出云端的作品包；点恢复后下载、关闭列表并交出本机路径', async () => {
  expect(document.body.textContent).toContain(name);
  expect(document.body.querySelector('[aria-label="Dropbox"]')?.textContent).toContain('2.0 KB');

  button(`恢复 ${name}（Dropbox）`).click();
  await flushPromises();

  expect(api.downloadBackup).toHaveBeenCalledWith({ provider: 'dropbox', fileId: `/${name}` });
  expect(wrapper.emitted('restore')).toEqual([[downloadedPath]]);
  expect(useCloudSyncStore().restoreOpen).toBe(false);
});

it('下载途中关闭再打开恢复列表，上一轮下载结束也不进入导入', async () => {
  const download = Promise.withResolvers<Awaited<ReturnType<CloudSyncApi['downloadBackup']>>>();
  vi.mocked(api.downloadBackup).mockReturnValueOnce(download.promise);
  button(`恢复 ${name}（Dropbox）`).click();
  await flushPromises();

  button('关闭').click();
  await flushPromises();
  expect(useCloudSyncStore().restoreOpen).toBe(false);
  useCloudSyncStore().restoreOpen = true;
  await flushPromises();

  download.resolve({ ok: true, path: downloadedPath });
  await flushPromises();

  expect(api.discardDownload).toHaveBeenCalledWith(downloadedPath);
  expect(wrapper.emitted('restore')).toBeUndefined();
  expect(useCloudSyncStore().restoreOpen).toBe(true);
});

it('备份条目取到摘要后显示文稿、资料和图片数量', async () => {
  const backup = useCloudSyncStore().backups[0]!;
  backup.summary = { manuscripts: 24, resources: 8, images: 3 };
  await flushPromises();

  expect(document.body.textContent?.replace(/\s+/g, ' ')).toContain('24 篇文稿 · 8 项资料（含 3 张图片）');
});

it('两家网盘的作品包分别列在各自的分组，同名备份仍可单独选择', async () => {
  useCloudSyncStore().backups.push({ provider: 'onedrive', id: `/${name}`, name });
  await flushPromises();

  const groups = [...document.body.querySelectorAll('[role="dialog"] section')];
  expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['Dropbox', 'OneDrive']);
  expect(groups.map(group => [...group.querySelectorAll('li')].map(item => item.textContent))).toEqual([
    [expect.stringContaining(name)],
    [expect.stringContaining(name)]
  ]);
  button(`恢复 ${name}（OneDrive）`).click();
  await flushPromises();
  expect(api.downloadBackup).toHaveBeenCalledWith({ provider: 'onedrive', fileId: `/${name}` });
});

it('删除先确认，只移除确认的网盘副本', async () => {
  const secondCopy = { provider: 'onedrive' as const, id: `/${name}`, name };
  useCloudSyncStore().backups.push(secondCopy);
  await flushPromises();
  button(`删除 ${name}（Dropbox）`).click();
  await flushPromises();

  const confirm = document.body.querySelector('[role="alertdialog"]')!;
  expect(confirm.textContent).toContain(`从 Dropbox 删除“${name}”？`);
  expect(api.deleteBackup).not.toHaveBeenCalled();

  [...confirm.querySelectorAll('button')].find(item => item.textContent?.trim() === '删除')!.click();
  await flushPromises();

  expect(api.deleteBackup).toHaveBeenCalledWith({ provider: 'dropbox', fileId: `/${name}` });
  expect(useCloudSyncStore().backups).toEqual([secondCopy]);
});
