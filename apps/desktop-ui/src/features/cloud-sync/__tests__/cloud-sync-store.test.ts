import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudAccount, CloudSyncState } from '@chaptale/ipc-contract';

import { useCloudSyncStore } from '../store';

type CloudSyncApi = NonNullable<typeof window.chaptaleDesktop>['cloudSync'];

const account: CloudAccount = {
  provider: 'dropbox',
  displayName: 'writer@example.com',
  connectedAt: '2026-09-13T00:00:00.000Z'
};

function cloudState(accounts: CloudAccount[] = []): CloudSyncState {
  return {
    availability: [
      { provider: 'dropbox', configured: true },
      { provider: 'onedrive', configured: false }
    ],
    accounts,
    authorizing: null
  };
}

function installApi(overrides: Partial<CloudSyncApi> = {}) {
  const api: CloudSyncApi = {
    getState: vi.fn().mockResolvedValue(cloudState()),
    getBinding: vi.fn().mockResolvedValue({ ok: false, code: 'no-binding', message: '这部作品还没有绑定云端备份位置' }),
    beginAuth: vi.fn(),
    cancelAuth: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(cloudState()),
    listFolders: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn().mockResolvedValue({ ok: true }),
    listBackups: vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'no-binding', message: '这部作品还没有绑定云端备份位置' }),
    createBackup: vi.fn(),
    planRestore: vi.fn(),
    readRestoreDiff: vi.fn(),
    applyRestore: vi.fn(),
    cancelRestore: vi.fn().mockResolvedValue({ ok: true }),
    removeBackups: vi.fn().mockResolvedValue({ ok: true, removed: [], failed: [] }),
    onBackupProgress: vi.fn().mockReturnValue(() => undefined),
    ...overrides
  };

  window.chaptaleDesktop = { cloudSync: api } as unknown as NonNullable<typeof window.chaptaleDesktop>;

  return api;
}

beforeEach(() => {
  setActivePinia(createPinia());
  delete window.chaptaleDesktop;
});

describe('云端账户与目录浏览', () => {
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
  it('登录成功后刷新账户并直接列出云端顶层', async () => {
    const api = installApi({
      beginAuth: vi.fn().mockResolvedValue({ ok: true, account }),
      getState: vi.fn().mockResolvedValue(cloudState([account])),
      listFolders: vi.fn().mockResolvedValue({
        ok: true,
        current: { id: null, name: '应用文件夹', root: true },
        parentId: null,
        folders: [{ id: '/备份', name: '备份', root: false }]
      })
    });
    const store = useCloudSyncStore();

    await store.signIn('dropbox');

    expect(api.listFolders).toHaveBeenCalledWith({ provider: 'dropbox', parentId: null });
    expect(store.accounts).toEqual([account]);
    expect(store.listing?.folders).toEqual([{ id: '/备份', name: '备份', root: false }]);
    expect(store.busy).toBeNull();
    expect(store.error).toBe('');
  });
  it('取消授权是作者的正常选择，不当错误展示；超时与拒绝要看得见', async () => {
    const store = useCloudSyncStore();
    const beginAuth = vi.fn().mockResolvedValue({ ok: false, code: 'canceled', message: '已取消登录' });
    const api = installApi({ beginAuth });

    await store.signIn('dropbox');

    expect(store.error).toBe('');
    expect(api.listFolders).not.toHaveBeenCalled();

    beginAuth.mockResolvedValue({ ok: false, code: 'timeout', message: '等待授权超时，请重新发起登录' });
    await store.signIn('dropbox');

    expect(store.error).toContain('超时');
  });
  it('退出登录以主进程返回的状态为准，并收起该服务商的目录浏览', async () => {
    const api = installApi({
      listFolders: vi.fn().mockResolvedValue({
        ok: true,
        current: { id: null, name: '应用文件夹', root: true },
        parentId: null,
        folders: []
      }),
      signOut: vi.fn().mockResolvedValue(cloudState())
    });
    const store = useCloudSyncStore();

    await store.openFolder('dropbox', null);
    expect(store.browseProvider).toBe('dropbox');

    await store.signOut('dropbox');

    expect(api.signOut).toHaveBeenCalledWith({ provider: 'dropbox' });
    expect(store.accounts).toEqual([]);
    expect(store.browseProvider).toBeNull();
    expect(store.listing).toBeNull();
  });
  it('列出目录失败时清空列表并保留原因，不显示过期内容', async () => {
    installApi({
      listFolders: vi.fn().mockResolvedValue({ ok: false, code: 'not-signed-in', message: '请先登录 Dropbox' })
    });
    const store = useCloudSyncStore();

    await store.openFolder('dropbox', '/备份');

    expect(store.listing).toBeNull();
    expect(store.listingError).toBe('请先登录 Dropbox');
    expect(store.isListingLoading).toBe(false);
  });
});
