import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWorkspaceStore } from '@/features/workspace';

import { useCloudSyncStore } from '../store';
import type { RestoreWizardState } from '../store/types';

function wizard(): RestoreWizardState {
  return {
    archiveId: 'backup.zip',
    archiveName: '作品备份.zip',
    plan: { archiveId: 'backup.zip', identityMatches: true, entries: [], emptyDirectories: [], localOnly: 0 },
    mode: 'new',
    choices: {},
    diff: null,
    receipt: null,
    workspace: { rootPath: '/work/novel', revision: 1 }
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  useWorkspaceStore().$patch({ rootPath: '/work/novel', revision: 1 });
});

describe('恢复操作边界', () => {
  it.each(['new', 'overwrite', 'merge'] as const)('作品代次变化后禁止 %s 恢复', async mode => {
    const cloud = useCloudSyncStore();
    cloud.wizard = { ...wizard(), mode };
    expect(cloud.restoreBlockedReason).toBe('');

    useWorkspaceStore().revision += 1;
    expect(cloud.restoreBlockedReason).toContain('作品已切换');
    await cloud.applyRestore();
    expect(cloud.isApplying).toBe(false);
    expect(cloud.backupError).toBe('');
    expect(cloud.wizard.receipt).toBeNull();
  });

  it('执行期间保留原模式、决议和向导', async () => {
    const cloud = useCloudSyncStore();
    cloud.wizard = wizard();
    cloud.isApplying = true;
    const original = cloud.wizard;

    cloud.setRestoreMode('merge');
    cloud.setRestoreChoice('正文.md', 'archive');
    cloud.setRestoreChoices(['人物.md'], 'both');
    await cloud.closeRestore();
    await cloud.openRestore('other.zip', '另一份归档');

    expect(cloud.wizard).toBe(original);
    expect(cloud.wizard.mode).toBe('new');
    expect(cloud.wizard.choices).toEqual({});
  });

  it('没有向导时的关闭、决议和空重载均无副作用', async () => {
    const cloud = useCloudSyncStore();
    cloud.setRestoreMode('merge');
    cloud.setRestoreChoice('正文.md', 'archive');
    cloud.setRestoreChoices([], 'local');
    await cloud.closeRestore();
    await cloud.refreshRestoredTabs([]);
    await cloud.applyRestore();

    expect(cloud.wizard).toBeNull();
    expect(cloud.backupError).toBe('');
    expect(cloud.isApplying).toBe(false);
  });

  it('关闭目录浏览时清除加载和错误状态', () => {
    const cloud = useCloudSyncStore();
    cloud.browseProvider = 'dropbox';
    cloud.isListingLoading = true;
    cloud.listingError = '旧请求错误';
    cloud.closeFolder();

    expect(cloud.browseProvider).toBeNull();
    expect(cloud.listing).toBeNull();
    expect(cloud.isListingLoading).toBe(false);
    expect(cloud.listingError).toBe('');
  });
});

describe('备份清单归属', () => {
  it('同一作品保留清单，重新打开或切换作品后清空旧状态', () => {
    const cloud = useCloudSyncStore();
    cloud.syncWorkspace();
    cloud.binding = { provider: 'dropbox', folderId: 'old', folderName: '旧目录', boundAt: '' };
    cloud.archives = [{ id: 'old.zip', name: '旧归档.zip', sizeBytes: 100, modifiedAt: null }];
    cloud.lastBackupAt = '2026-09-16T00:00:00Z';
    cloud.notice = '旧回执';
    cloud.syncWorkspace();
    expect(cloud.archives).toHaveLength(1);

    useWorkspaceStore().revision += 1;
    cloud.syncWorkspace();
    expect(cloud.binding).toBeNull();
    expect(cloud.archives).toEqual([]);
    expect(cloud.lastBackupAt).toBe('');
    expect(cloud.notice).toBe('');
  });

  it('切换作品后旧归档 ID 不能继续提交删除', async () => {
    const cloud = useCloudSyncStore();
    cloud.syncWorkspace();
    cloud.archives = [{ id: 'old.zip', name: '旧归档.zip', sizeBytes: 100, modifiedAt: null }];
    useWorkspaceStore().rootPath = '/work/other';

    await cloud.removeBackups(['old.zip']);

    expect(cloud.archives).toEqual([]);
    expect(cloud.backupError).toBe('归档清单已变化，请刷新后重新选择');
    await cloud.removeBackups([]);
    expect(cloud.notice).toBe('');
  });
});
