import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudAccount, CloudBackupArchive, CloudBinding, CloudSyncState } from '@chaptale/ipc-contract';

import { useEditorStore } from '@/features/editor';

import { formatSize, formatWhen, useCloudSyncStore } from '../store';

type CloudSyncApi = NonNullable<typeof window.chaptaleDesktop>['cloudSync'];

const account: CloudAccount = {
  provider: 'dropbox',
  displayName: 'writer@example.com',
  connectedAt: '2026-09-13T00:00:00.000Z'
};

const binding: CloudBinding = {
  provider: 'dropbox',
  folderId: '',
  folderName: '应用文件夹',
  boundAt: '2026-09-13T00:00:00.000Z'
};

const archive: CloudBackupArchive = {
  id: '/拾光之城 pc 20260913-210405.zip',
  name: '拾光之城 pc 20260913-210405.zip',
  sizeBytes: 2048,
  modifiedAt: '2026-09-13T21:04:05Z'
};

function cloudState(accounts: CloudAccount[] = []): CloudSyncState {
  return {
    availability: [
      { provider: 'dropbox', configured: true },
      { provider: 'onedrive', configured: false },
      { provider: 'nutstore', configured: false }
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
    removeBackup: vi.fn().mockResolvedValue({ ok: true }),
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

describe('云同步 store', () => {
  it('读取状态失败时只留下错误文案，不抛出到界面', async () => {
    const getState = vi.fn().mockResolvedValue(cloudState());
    installApi({ getState });
    const store = useCloudSyncStore();

    await store.load();

    expect(store.state?.availability).toHaveLength(3);
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
  it('未绑定不算错误：界面据此显示绑定入口而不是报错', async () => {
    installApi();
    const store = useCloudSyncStore();

    await store.loadBackups();

    expect(store.binding).toBeNull();
    expect(store.archives).toEqual([]);
    expect(store.backupError).toBe('');
    expect(store.isBackupLoading).toBe(false);
  });
  it('绑定成功后重新拉取清单并收起目录浏览器', async () => {
    const api = installApi({
      bind: vi.fn().mockResolvedValue({ ok: true, binding, lastBackupAt: null }),
      getBinding: vi.fn().mockResolvedValue({ ok: true, binding, lastBackupAt: null }),
      listBackups: vi
        .fn()
        .mockResolvedValue({ ok: true, binding, archives: [archive], quota: { usedBytes: 10, totalBytes: 100 } })
    });
    const store = useCloudSyncStore();

    store.browseProvider = 'dropbox';

    expect(await store.bind('dropbox', null, '应用文件夹')).toBe(true);
    expect(api.bind).toHaveBeenCalledWith({ provider: 'dropbox', folderId: null, folderName: '应用文件夹' });
    expect(store.binding).toEqual(binding);
    expect(store.archives).toEqual([archive]);
    expect(store.quota).toEqual({ usedBytes: 10, totalBytes: 100 });
    expect(store.browseProvider).toBeNull();
  });
  it('绑定失败保留原因且不改动既有绑定', async () => {
    installApi({
      bind: vi
        .fn()
        .mockResolvedValue({ ok: false, code: 'failed', message: '这个云端目录属于另一部作品（旧稿），不能绑定' })
    });
    const store = useCloudSyncStore();

    expect(await store.bind('dropbox', '/旧稿', '旧稿')).toBe(false);
    expect(store.backupError).toContain('另一部作品');
  });
  it('备份结束后刷新清单并给出可读回执，进度被清空', async () => {
    const store = useCloudSyncStore();

    installApi({
      createBackup: vi.fn().mockResolvedValue({ ok: true, archive, files: 12, bytes: 2048 }),
      listBackups: vi.fn().mockResolvedValue({ ok: true, binding, archives: [archive], quota: null })
    });

    store.applyProgress({ phase: 'packing', done: 3, total: 12 });

    await store.createBackup();

    expect(store.notice).toContain('12 个文件');
    expect(store.archives).toEqual([archive]);
    expect(store.progress).toBeNull();
    expect(store.isBackupRunning).toBe(false);
  });
  it('备份失败时保留主进程文案，且不谎报成功回执', async () => {
    installApi({
      createBackup: vi
        .fn()
        .mockResolvedValue({ ok: false, code: 'failed', message: '归档 210 MB 超过 Dropbox 单次上传上限 150 MB' })
    });
    const store = useCloudSyncStore();

    await store.createBackup();

    expect(store.backupError).toContain('超过 Dropbox 单次上传上限');
    expect(store.notice).toBe('');
  });
  it('打开向导只算计划，不动任何文件；默认停在零风险的新增', async () => {
    const planRestore = vi.fn().mockResolvedValue({
      ok: true,
      plan: {
        archiveId: archive.id,
        identityMatches: true,
        entries: [
          { relativePath: '正文.md', verdict: 'conflict', archiveBytes: 100, localBytes: 120, system: false },
          {
            relativePath: '.chaptale/memory/notes.md',
            verdict: 'conflict',
            archiveBytes: 10,
            localBytes: 12,
            system: true
          },
          { relativePath: '灵感/片段.md', verdict: 'add', archiveBytes: 30, localBytes: null, system: false },
          { relativePath: 'chaptale.json', verdict: 'identical', archiveBytes: 40, localBytes: 40, system: false }
        ],
        emptyDirectories: ['草稿'],
        localOnly: 2
      }
    });
    const applyRestore = vi.fn();

    installApi({ planRestore, applyRestore });
    const store = useCloudSyncStore();

    await store.openRestore(archive.id, archive.name);

    expect(planRestore).toHaveBeenCalledWith({ archiveId: archive.id });
    expect(store.wizard?.mode).toBe('new');
    expect(store.wizard?.plan.localOnly).toBe(2);
    // 打开向导不该执行任何写入。
    expect(applyRestore).not.toHaveBeenCalled();
    // 新增模式没有硬拦截。
    expect(store.restoreBlockedReason).toBe('');
  });
  it('计划都算不出来就不开向导，只留原因', async () => {
    installApi({ planRestore: vi.fn().mockResolvedValue({ ok: false, code: 'network', message: '连不上云端' }) });
    const store = useCloudSyncStore();

    await store.openRestore(archive.id, archive.name);

    expect(store.wizard).toBeNull();
    expect(store.backupError).toBe('连不上云端');
  });
  it('有未保存内容时覆盖与合并被硬拦，且请求根本发不出去', async () => {
    const applyRestore = vi.fn();

    installApi({
      planRestore: vi.fn().mockResolvedValue({
        ok: true,
        plan: {
          archiveId: archive.id,
          identityMatches: true,
          entries: [],
          emptyDirectories: [],
          localOnly: 0
        }
      }),
      applyRestore
    });
    const store = useCloudSyncStore();
    const editor = useEditorStore();

    await store.openRestore(archive.id, archive.name);
    store.setRestoreMode('overwrite');

    expect(store.restoreBlockedReason).toBe('');

    editor.tabs = [{ id: '正文.md', path: '正文.md', dirty: true } as never];
    expect(store.restoreBlockedReason).toContain('还没保存');

    await store.applyRestore();

    expect(applyRestore).not.toHaveBeenCalled();
    expect(store.wizard?.receipt).toBeNull();
  });
  it('归档不能自证身份时，覆盖与合并的模式被挡在门外', async () => {
    installApi({
      planRestore: vi.fn().mockResolvedValue({
        ok: true,
        plan: { archiveId: archive.id, identityMatches: false, entries: [], emptyDirectories: [], localOnly: 0 }
      })
    });
    const store = useCloudSyncStore();

    await store.openRestore(archive.id, archive.name);

    expect(store.restoreBlockedReason).toBe('');

    store.setRestoreMode('merge');

    expect(store.restoreBlockedReason).toContain('不能自证');
  });
  it('合并逐项决议：没决定的一项也不写，回执要按写入清单让编辑器重载', async () => {
    const applyRestore = vi.fn().mockResolvedValue({
      ok: true,
      targetPath: '/home/novel',
      mode: 'merge',
      written: 2,
      writtenPaths: ['正文.md', '草稿/02.md'],
      snapshotId: '20260913-210405',
      skipped: [{ relativePath: '草稿/01.md', reason: '你没对这项做决定，本地保持不动' }]
    });

    installApi({
      planRestore: vi.fn().mockResolvedValue({
        ok: true,
        plan: {
          archiveId: archive.id,
          identityMatches: true,
          entries: [
            { relativePath: '正文.md', verdict: 'conflict', archiveBytes: 100, localBytes: 120, system: false },
            { relativePath: '草稿/01.md', verdict: 'conflict', archiveBytes: 20, localBytes: 30, system: false },
            { relativePath: '草稿/02.md', verdict: 'conflict', archiveBytes: 20, localBytes: 30, system: false }
          ],
          emptyDirectories: [],
          localOnly: 0
        }
      }),
      applyRestore
    });
    const store = useCloudSyncStore();
    const editor = useEditorStore();

    await store.openRestore(archive.id, archive.name);
    store.setRestoreMode('merge');
    store.setRestoreChoice('正文.md', 'archive');
    store.setRestoreChoices(['草稿/02.md'], 'both');

    // 草稿/01.md 还没决定：界面要能说清它不会被写入。
    expect(store.pendingConflicts).toEqual(['草稿/01.md']);

    const refreshed = vi.spyOn(editor, 'refreshDocuments').mockResolvedValue(undefined);

    editor.tabs = [
      { id: '正文.md', path: '正文.md', dirty: false } as never,
      { id: '别的.md', path: '别的.md', dirty: false } as never
    ];

    await store.applyRestore();

    expect(applyRestore).toHaveBeenCalledWith({
      archiveId: archive.id,
      mode: 'merge',
      choices: { '正文.md': 'archive', '草稿/02.md': 'both' }
    });
    // 决议表要跨 IPC：Vue 的响应式 Proxy 过不了结构化克隆（真机上报
    // “An object could not be cloned”），所以必须是纯数据。
    const [sentArgs] = applyRestore.mock.calls[0] as [unknown];

    expect(() => structuredClone(sentArgs)).not.toThrow();
    // 只重载被写过的文件：清单之外的 tab 不动。
    expect(refreshed).toHaveBeenCalledWith(['正文.md']);
    expect(store.wizard?.receipt?.snapshotId).toBe('20260913-210405');
  });
  it('关掉向导时，没执行过的这次恢复要把待用归档清掉', async () => {
    const cancelRestore = vi.fn().mockResolvedValue({ ok: true });

    installApi({
      planRestore: vi.fn().mockResolvedValue({
        ok: true,
        plan: { archiveId: archive.id, identityMatches: true, entries: [], emptyDirectories: [], localOnly: 0 }
      }),
      cancelRestore
    });
    const store = useCloudSyncStore();

    await store.openRestore(archive.id, archive.name);
    await store.closeRestore();

    expect(cancelRestore).toHaveBeenCalledTimes(1);
    expect(store.wizard).toBeNull();
  });
  it('状态栏用的轻量查询只读本机绑定，未绑定时不留下陈旧值', async () => {
    const getBinding = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'no-binding', message: '这部作品还没有绑定云端备份位置' });
    installApi({ getBinding });
    const store = useCloudSyncStore();

    store.binding = binding;
    store.lastBackupAt = '2026-09-13T21:04:05.000Z';
    await store.loadBinding();

    expect(store.binding).toBeNull();
    expect(store.lastBackupAt).toBe('');

    getBinding.mockResolvedValue({ ok: true, binding, lastBackupAt: '2026-09-13T21:04:05.000Z' });
    await store.loadBinding();

    expect(store.binding).toEqual(binding);
    expect(store.lastBackupAt).toBe('2026-09-13T21:04:05.000Z');
  });
  it('云端不可用时留下真实原因，与“还没绑”分开表达', async () => {
    installApi({
      getBinding: vi.fn().mockResolvedValue({
        ok: false,
        code: 'failed',
        message: '这部作品缺少 chaptale.json，云端备份需要它来核对身份'
      })
    });
    const store = useCloudSyncStore();

    await store.loadBinding();

    expect(store.binding).toBeNull();
    expect(store.bindingError).toContain('chaptale.json');
  });
  it('尺寸与时间文案在几个量级上都可读', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5);

    // 今天的备份只给时分；跨天补日期，且不带年份。
    expect(formatWhen(today.toISOString())).not.toContain('月');
    expect(formatWhen(new Date(2026, 0, 3, 9, 5).toISOString())).toContain('1月3日');
  });
});
