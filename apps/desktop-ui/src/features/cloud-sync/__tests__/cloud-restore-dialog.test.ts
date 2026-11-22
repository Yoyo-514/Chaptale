import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/features/settings';

import CloudRestoreDialog from '../components/CloudRestoreDialog.vue';
import { formatWhen } from '../presentation';
import { type CloudBackupItem, useCloudSyncStore } from '../store';

type CloudSyncApi = NonNullable<typeof window.chaptaleDesktop>['cloudSync'];

const downloadedPath = 'C:/Temp/chaptale-restore-1/backup.chaptale';
const summary = { manuscripts: 24, resources: 8, images: 3 };
const newer = '2026-11-21T01:43:00.000Z';
const older = '2026-11-20T09:00:00.000Z';
/** 《雨夜》在 Dropbox 上的一份备份；按需改时间、来源和所在账户。 */
function backup(at: string, patch: Partial<CloudBackupItem> = {}, kind: 'manual' | 'auto' = 'manual'): CloudBackupItem {
  return {
    provider: 'dropbox',
    id: `/雨夜-${at}`,
    name: `雨夜-${at}.chaptale`,
    size: 2048,
    info: { workId: 'w1', title: '雨夜', at, kind, device: 'DESKTOP-7F3K', summary },
    ...patch
  };
}
const label = (verb: string, at: string, provider = 'Dropbox') => `${verb} 《雨夜》 ${formatWhen(at)}（${provider}）`;
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
  store.state = {
    availability: [],
    authorizing: null,
    accounts: [{ provider: 'dropbox', displayName: '作者', connectedAt: newer }]
  };
  store.backups = [backup(newer)];
  store.restoreOpen = true;
  wrapper = mount(CloudRestoreDialog, { attachTo: document.body });
  await flushPromises();
});
afterEach(() => {
  wrapper.unmount();
  delete window.chaptaleDesktop;
});

const button = (name: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const text = () => document.body.textContent!.replace(/\s+/g, ' ');

it('条目写明时间、来源和条目数，不出现文件名；点恢复后下载、关闭列表并交出本机路径', async () => {
  expect(text()).toContain(formatWhen(newer));
  expect(text()).toContain('手动 · DESKTOP-7F3K · Dropbox');
  expect(text()).toContain('24 篇文稿 · 8 项资料（含 3 张图片） · 2.0 KB');
  expect(text()).not.toContain('.chaptale');

  button(label('恢复', newer)).click();
  await flushPromises();

  expect(api.downloadBackup).toHaveBeenCalledWith({ provider: 'dropbox', fileId: `/雨夜-${newer}` });
  expect(wrapper.emitted('restore')).toEqual([[downloadedPath]]);
  expect(useCloudSyncStore().restoreOpen).toBe(false);
});

it('下载途中关闭再打开恢复列表，上一轮下载结束也不进入导入', async () => {
  const download = Promise.withResolvers<Awaited<ReturnType<CloudSyncApi['downloadBackup']>>>();
  vi.mocked(api.downloadBackup).mockReturnValueOnce(download.promise);
  button(label('恢复', newer)).click();
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

it('按作品分组，每部只显示最新一份，其余点开再看；认不出名字的包列在最后', async () => {
  useCloudSyncStore().backups.push(
    backup(older, { provider: 'onedrive' }, 'auto'),
    backup(newer, { id: '/长夜', info: { ...backup(newer).info!, workId: 'w2', title: '长夜' } }),
    { provider: 'dropbox', id: '/旧包.chaptale', name: '旧包.chaptale' }
  );
  await flushPromises();

  const groups = () => [...document.body.querySelectorAll('[role="dialog"] section')];
  expect(groups().map(group => [group.getAttribute('aria-label'), group.querySelectorAll('li').length])).toEqual([
    ['《雨夜》', 1],
    ['《长夜》', 1],
    ['其他作品包', 1]
  ]);
  expect(groups()[2]!.textContent).toContain('旧包.chaptale');

  [...groups()[0]!.querySelectorAll('button')].find(item => item.textContent?.trim() === '其余 1 份')!.click();
  await flushPromises();

  expect(groups()[0]!.querySelectorAll('li')).toHaveLength(2);
  expect(text()).toContain('自动 · DESKTOP-7F3K · OneDrive');
  button(label('恢复', older, 'OneDrive')).click();
  await flushPromises();
  expect(api.downloadBackup).toHaveBeenCalledWith({ provider: 'onedrive', fileId: `/雨夜-${older}` });
});

it('删除先确认，只移除确认的那一份', async () => {
  const kept = backup(newer, { provider: 'onedrive' });
  useCloudSyncStore().backups.push(kept);
  useCloudSyncStore().backupsError = '';
  await flushPromises();
  [...document.body.querySelectorAll('button')].find(item => item.textContent?.trim() === '其余 1 份')!.click();
  await flushPromises();
  button(label('删除', newer)).click();
  await flushPromises();

  const confirm = document.body.querySelector('[role="alertdialog"]')!;
  expect(confirm.textContent).toContain('从 Dropbox 删除这份备份？');
  expect(confirm.textContent).toContain(formatWhen(newer));
  expect(api.deleteBackup).not.toHaveBeenCalled();

  [...confirm.querySelectorAll('button')].find(item => item.textContent?.trim() === '删除')!.click();
  await flushPromises();

  expect(api.deleteBackup).toHaveBeenCalledWith({ provider: 'dropbox', fileId: `/雨夜-${newer}` });
  expect(useCloudSyncStore().backups).toEqual([kept]);
});

it('读取或下载失败的原因显示在列表上方', async () => {
  useCloudSyncStore().backupsError = 'Dropbox：网络不可用';
  await flushPromises();

  const alert = document.body.querySelector('[role="alert"]')!;
  expect(alert.textContent).toBe('Dropbox：网络不可用');
  expect(alert.compareDocumentPosition(document.body.querySelector('[role="dialog"] section')!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );
});

it('没有登录云端账户时说明原因，按钮打开云端账户设置', async () => {
  useCloudSyncStore().state!.accounts = [];
  await flushPromises();

  expect(text()).toContain('还没有登录云端账户');
  [...document.body.querySelectorAll('button')].find(item => item.textContent?.trim() === '打开云端账户')!.click();
  await flushPromises();

  expect(useCloudSyncStore().restoreOpen).toBe(false);
  expect(useSettingsStore().isOpen).toBe(true);
  expect(useSettingsStore().activeSection).toBe('cloudSync');
});
