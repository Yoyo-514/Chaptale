import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudAccount, CloudSyncState } from '@chaptale/desktop/bridge';

import { useNotificationStore } from '@/features/notifications';
import { useSettingsStore } from '@/features/settings';

import { useCloudSyncStore } from '../store';

type CloudSyncApi = NonNullable<typeof window.chaptaleDesktop>['cloudSync'];

const account: CloudAccount = {
  provider: 'dropbox',
  displayName: 'writer@example.com',
  connectedAt: '2026-09-13T00:00:00.000Z'
};

const second: CloudAccount = { provider: 'onedrive', displayName: '写作', connectedAt: '2026-09-14T00:00:00.000Z' };
const older = {
  id: '/雨夜_2026-11-20_0900.chaptale',
  name: '雨夜_2026-11-20_0900.chaptale',
  modifiedAt: '2026-11-20T01:00:00Z'
};
const newer = {
  id: '/雨夜_2026-11-21_0143.chaptale',
  name: '雨夜_2026-11-21_0143.chaptale',
  modifiedAt: '2026-11-20T17:43:00Z'
};

function cloudState(accounts: CloudAccount[] = []): CloudSyncState {
  return {
    availability: [
      { provider: 'dropbox', configured: true },
      { provider: 'onedrive', configured: true }
    ],
    accounts,
    authorizing: null
  };
}

function installApi(overrides: Partial<CloudSyncApi> = {}) {
  const api: CloudSyncApi = {
    getState: vi.fn().mockResolvedValue(cloudState()),
    beginAuth: vi.fn(),
    cancelAuth: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(cloudState()),
    backupWork: vi.fn(),
    listBackups: vi.fn(),
    downloadBackup: vi.fn(),
    deleteBackup: vi.fn(),
    discardDownload: vi.fn(),
    ...overrides
  };

  window.chaptaleDesktop = { cloudSync: api } as unknown as NonNullable<typeof window.chaptaleDesktop>;

  return api;
}

beforeEach(() => {
  setActivePinia(createPinia());
  delete window.chaptaleDesktop;
});

describe('云端账户与作品包备份', () => {
  it('读取状态失败时只留下错误文案，不抛出到界面', async () => {
    const getState = vi.fn().mockResolvedValue(cloudState());
    installApi({ getState });
    const store = useCloudSyncStore();

    await store.load();

    expect(store.state?.availability).toHaveLength(2);
    expect(store.isLoading).toBe(false);

    getState.mockRejectedValueOnce(new Error('主进程未响应'));
    await store.load();

    expect(store.error).toBe('主进程未响应');
    expect(store.isLoading).toBe(false);
  });
  it('登录成功后刷新账户', async () => {
    installApi({
      beginAuth: vi.fn().mockResolvedValue({ ok: true, account }),
      getState: vi.fn().mockResolvedValue(cloudState([account]))
    });
    const store = useCloudSyncStore();

    await store.signIn('dropbox');

    expect(store.accounts).toEqual([account]);
    expect(store.busy).toBeNull();
    expect(store.error).toBe('');
  });
  it('取消授权是作者的正常选择，不当错误展示；超时与拒绝要看得见', async () => {
    const store = useCloudSyncStore();
    const beginAuth = vi.fn().mockResolvedValue({ ok: false, code: 'canceled', message: '已取消登录' });
    installApi({ beginAuth });

    await store.signIn('dropbox');

    expect(store.error).toBe('');

    beginAuth.mockResolvedValue({ ok: false, code: 'timeout', message: '等待授权超时，请重新发起登录' });
    await store.signIn('dropbox');

    expect(store.error).toContain('超时');
  });
  it('退出登录以主进程返回的状态为准', async () => {
    const api = installApi({
      getState: vi.fn().mockResolvedValue(cloudState([account])),
      signOut: vi.fn().mockResolvedValue(cloudState())
    });
    const store = useCloudSyncStore();
    await store.load();

    await store.signOut('dropbox');

    expect(api.signOut).toHaveBeenCalledWith({ provider: 'dropbox' });
    expect(store.accounts).toEqual([]);
  });
  it('两家已连接时提供一家或全部的选择。只选 OneDrive 时把目标原样交给宿主', async () => {
    const backupWork = vi.fn<CloudSyncApi['backupWork']>().mockResolvedValue({
      ok: true,
      uploads: [{ provider: 'onedrive', result: { ok: true, name: newer.name } }]
    });
    const getState = vi.fn<CloudSyncApi['getState']>().mockResolvedValue(cloudState([account, second]));
    installApi({ getState, backupWork });
    const store = useCloudSyncStore();
    await store.load();

    const options = store.backupMenu.items!;
    expect(options.map(option => option.label)).toEqual(['Dropbox', 'OneDrive', '全部已登录网盘']);
    store.selectBackup(options[1]!.id, { id: 'w1', title: '雨夜' });
    await expect.poll(() => useNotificationStore().items[0]?.kind).toBe('success');
    expect(backupWork).toHaveBeenCalledExactlyOnceWith({ workId: 'w1', target: 'onedrive' }, expect.any(Function));

    getState.mockResolvedValue(cloudState([account]));
    await store.load();
    expect(store.backupMenu.label).toBe('备份到 Dropbox');
    expect(store.backupMenu.items).toBeUndefined();
  });

  it('选全部后在同一条通知显示上传阶段和各家结果', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<CloudSyncApi['backupWork']>>>();
    const backupWork = vi.fn<CloudSyncApi['backupWork']>().mockReturnValue(pending.promise);
    installApi({ backupWork });
    const notices = useNotificationStore();

    const result = useCloudSyncStore().backupWork({ id: 'w1', title: '雨夜' }, 'all');
    const id = notices.items[0]?.id;
    expect(notices.items).toMatchObject([{ description: '正在生成作品包…', inProgress: true }]);
    const [[args, onUpload]] = backupWork.mock.calls;
    expect(args).toEqual({ workId: 'w1', target: 'all' });
    onUpload({ provider: 'onedrive', current: 2, total: 2 });
    expect(notices.items).toMatchObject([{ id, description: '正在上传到 OneDrive（2/2）', inProgress: true }]);

    pending.resolve({
      ok: true,
      uploads: [
        { provider: 'dropbox', result: { ok: true, name: '雨夜_2026-11-21_0143.chaptale' } },
        { provider: 'onedrive', result: { ok: false, code: 'network', message: '上传归档失败（HTTP 507）' } }
      ]
    });
    await result;
    expect(notices.items).toMatchObject([
      {
        id,
        kind: 'error',
        inProgress: false,
        description: 'Dropbox：雨夜_2026-11-21_0143.chaptale\nOneDrive：上传归档失败（HTTP 507）'
      }
    ]);
  });
  it('没有登录云账号时，备份和恢复入口都打开云端账户设置', async () => {
    const api = installApi();
    const store = useCloudSyncStore();
    const settings = useSettingsStore();

    await store.load();
    store.selectBackup(store.backupMenu.id, { id: 'w1', title: '雨夜' });
    expect(api.backupWork).not.toHaveBeenCalled();
    expect(settings.isOpen).toBe(true);
    expect(settings.activeSection).toBe('cloudSync');
    settings.closePanel();
    await store.openRestore();
    expect(api.listBackups).not.toHaveBeenCalled();
    expect(store.restoreOpen).toBe(false);
    expect(useSettingsStore().isOpen).toBe(true);
    expect(useSettingsStore().activeSection).toBe('cloudSync');
  });
  it('恢复列表里新的包排在前面；读不到的账号写明是哪一家', async () => {
    installApi({
      getState: vi.fn().mockResolvedValue(cloudState([account, second])),
      listBackups: vi.fn(async ({ provider }: { provider: string }) =>
        provider === 'dropbox'
          ? { ok: true, backups: [older, newer] }
          : { ok: false, code: 'network', message: '列出目录失败（HTTP 503）' }
      ) as CloudSyncApi['listBackups']
    });
    const store = useCloudSyncStore();

    await store.openRestore();

    expect(store.restoreOpen).toBe(true);
    expect(store.backups).toEqual([
      { ...newer, provider: 'dropbox' },
      { ...older, provider: 'dropbox' }
    ]);
    expect(store.backupsError).toBe('OneDrive：列出目录失败（HTTP 503）');
    expect(store.backupsLoading).toBe(false);
  });
  it('下载成功交出本机路径；下载或删除失败时保留列表并留下原因；删除成功后从列表移除', async () => {
    const api = installApi({
      getState: vi.fn().mockResolvedValue(cloudState([account])),
      listBackups: vi.fn().mockResolvedValue({ ok: true, backups: [older, newer] }),
      downloadBackup: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, path: 'C:/Temp/chaptale-restore-1/backup.chaptale' })
        .mockRejectedValueOnce(new Error('主进程未响应')),
      deleteBackup: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: 'network', message: '删除云端归档失败' })
        .mockResolvedValueOnce({ ok: true })
    });
    const store = useCloudSyncStore();
    await store.openRestore();
    const [latest, earlier] = store.backups;

    expect(await store.downloadBackup(latest!)).toBe('C:/Temp/chaptale-restore-1/backup.chaptale');
    expect(api.downloadBackup).toHaveBeenCalledWith({ provider: 'dropbox', fileId: newer.id });
    expect(await store.downloadBackup(latest!)).toBeNull();
    expect(store.backupsError).toBe('主进程未响应');

    await store.deleteBackup(earlier!);
    expect(store.backupsError).toBe('删除云端归档失败');
    expect(store.backups).toHaveLength(2);

    await store.deleteBackup(earlier!);
    expect(store.backupsError).toBe('');
    expect(store.backups).toEqual([{ ...newer, provider: 'dropbox' }]);
    expect(store.transferring).toBeNull();
  });
});
