import { defineStore } from 'pinia';

import { useEditorStore } from '@/features/editor';
import { useWorkspaceStore } from '@/features/workspace';

import { cloudAccountActions } from './store/account-actions';
import { cloudBackupActions } from './store/backup-actions';
import { cloudRestoreActions } from './store/restore-actions';
import type { CloudSyncStoreState } from './store/types';

/** 云端备份：账户、云端目录浏览与归档清单。授权与备份都是"结束才返回"，所以 `busy` 同时承担等待中的界面语义。 */
export const useCloudSyncStore = defineStore('cloudSync', {
  state: (): CloudSyncStoreState => ({
    state: null,
    isLoading: false,
    error: '',
    /** 正在等待授权或登出落定的服务商；界面据此禁掉重复入口。 */
    busy: null,
    browseProvider: null,
    listing: null,
    isListingLoading: false,
    listingError: '',
    folderRequest: 0,
    workspaceScope: null,
    bindingRequest: 0,
    backupRequest: 0,
    /** 当前作品的云端绑定；null 表示未绑定。 */
    binding: null,
    /** 绑定查询失败的原因（如作品缺少 chaptale.json）；未绑定不算失败，所以这里为空。 */
    bindingError: '',
    /** 本机上次成功备份时间（ISO）；从没在本机备过就是空串。 */
    lastBackupAt: '',
    /** 自动备份最近一次失败；自动备份是静默的，不把它摆出来就等于没发生过。 */
    lastBackupError: null,
    archives: [],
    quota: null,
    isBackupLoading: false,
    backupError: '',
    /** 备份或恢复正在跑；进度只描述过程，结果以 `backupError` 与清单为准。 */
    progress: null,
    isBackupRunning: false,
    /** 上一次操作的成功回执（如恢复到了哪个目录）。 */
    notice: '',
    /** 恢复向导；null 表示向导没开。 */
    wizard: null,
    isPlanLoading: false,
    isApplying: false,
    restoreRequest: 0,
    diffRequest: 0
  }),
  getters: {
    /** 状态还没读到就按空处理：界面不必到处写 `state?.`。 */
    availability: state => state.state?.availability ?? [],
    accounts: state => state.state?.accounts ?? [],
    /** 进度文案只写一处：状态栏与设置面板说的是同一句话。 */
    progressLabel: state => {
      const progress = state.progress;

      if (!progress) return state.isBackupRunning ? '正在处理…' : '';
      if (progress.phase === 'uploading') return '正在上传归档…';

      return progress.total > 0 ? `正在打包：${progress.done}/${progress.total} 个文件` : '正在清点作品文件…';
    },
    /**
     * 覆盖与合并会动磁盘上的现有文件，所以它们的入口必须**不可达**（不是软提示）。
     *
     * 编辑器缓冲只在渲染进程里，主进程看不到：这道门只能在这里把。
     * 主进程侧另外还有两道（身份自证、快照先落地），三层各拦各的。
     */
    restoreBlockedReason(state): string {
      const wizard = state.wizard;
      if (!wizard || wizard.receipt) return '';

      const workspace = useWorkspaceStore();
      if (wizard.workspace.rootPath !== workspace.rootPath || wizard.workspace.revision !== workspace.revision) {
        return '作品已切换，请重新打开恢复向导';
      }
      if (wizard.mode === 'new') return '';

      if (!wizard.plan.identityMatches) {
        return '这份归档不能自证是当前作品，只能恢复到新目录';
      }

      const dirty = useEditorStore().tabs.filter(tab => tab.dirty || tab.saving);

      if (dirty.length === 0) return '';

      const names = dirty
        .slice(0, 3)
        .map(tab => tab.path)
        .join('、');

      return `有 ${dirty.length} 个文件还没保存（${names}${dirty.length > 3 ? ' 等' : ''}），先保存或关闭再覆盖`;
    },
    /** 合并里还没决定的冲突项：确认前要明确说清“它们不会被写入”。 */
    pendingConflicts(state): string[] {
      const wizard = state.wizard;

      if (!wizard?.plan) return [];

      return wizard.plan.entries
        .filter(entry => entry.verdict === 'conflict' && !wizard.choices[entry.relativePath])
        .map(entry => entry.relativePath);
    }
  },
  actions: {
    ...cloudAccountActions,
    ...cloudRestoreActions,
    ...cloudBackupActions
  }
});
