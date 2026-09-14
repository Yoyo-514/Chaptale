import { defineStore } from 'pinia';
import { toRaw } from 'vue';

import { AUTO_BACKUP_INTERVAL_MINUTES } from '@chaptale/ipc-contract';
import type {
  CloudBackupArchive,
  CloudBackupFailure,
  CloudBackupProgress,
  CloudBinding,
  CloudProvider,
  CloudQuota,
  CloudRemoteFolder,
  CloudRestoreChoice,
  CloudRestoreDiffResult,
  CloudRestoreMode,
  CloudRestorePlan,
  CloudRestoreResult,
  CloudSyncState
} from '@chaptale/ipc-contract';

import { useEditorStore } from '@/features/editor';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

/** 只保留成功载荷：判别联合塞进响应式 state 会让模板里的窄化变得别扭。 */
type CloudFolderListing = {
  current: CloudRemoteFolder;
  parentId: string | null;
  folders: CloudRemoteFolder[];
};

/** 恢复向导：从算出计划到拿到回执，中间每一步都是它自己的一份状态。 */
type RestoreWizard = {
  archiveId: string;
  /** 界面已经有归档名（清单里来的），不必让主进程再跑一趟远端去取。 */
  archiveName: string;
  plan: CloudRestorePlan;
  mode: CloudRestoreMode;
  /** 合并模式下逐项挑选的决议；没给的项不会被写、也不会被覆盖。 */
  choices: Record<string, CloudRestoreChoice>;
  /** 正在看的冲突项正文；`null` 表示没展开任何一项。 */
  diff: (CloudRestoreDiffResult & { ok: true; relativePath: string }) | null;
  /** 执行成功后的回执；有它就不再是“确认前”的状态。 */
  receipt: (CloudRestoreResult & { ok: true }) | null;
};

/** 云同步账户、云端目录浏览与作品备份。授权与备份都是"结束才返回"，所以 `busy` 同时承担等待中的界面语义。 */
export const useCloudSyncStore = defineStore('cloudSync', {
  state: () => ({
    state: null as CloudSyncState | null,
    isLoading: false,
    error: '',
    /** 正在等待授权或登出落定的服务商；界面据此禁掉重复入口。 */
    busy: null as CloudProvider | null,
    browseProvider: null as CloudProvider | null,
    listing: null as CloudFolderListing | null,
    isListingLoading: false,
    listingError: '',
    /** 当前作品的云端绑定；null 表示未绑定。 */
    binding: null as CloudBinding | null,
    /** 绑定查询失败的原因（如作品缺少 chaptale.json）；未绑定不算失败，所以这里为空。 */
    bindingError: '',
    /** 本机上次成功备份时间（ISO）；从没在本机备过就是空串。 */
    lastBackupAt: '',
    /** 自动备份最近一次失败；自动备份是静默的，不把它摆出来就等于没发生过。 */
    lastBackupError: null as CloudBackupFailure | null,
    archives: [] as CloudBackupArchive[],
    quota: null as CloudQuota | null,
    isBackupLoading: false,
    backupError: '',
    /** 备份或恢复正在跑；进度只描述过程，结果以 `backupError` 与清单为准。 */
    progress: null as CloudBackupProgress | null,
    isBackupRunning: false,
    /** 上一次操作的成功回执（如恢复到了哪个目录）。 */
    notice: '',
    /** 恢复向导；null 表示向导没开。 */
    wizard: null as RestoreWizard | null,
    isPlanLoading: false,
    isApplying: false
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
      if (!state.wizard || state.wizard.mode === 'new' || state.wizard.receipt) return '';

      if (!state.wizard.plan.identityMatches) {
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
    async load() {
      this.isLoading = true;
      this.error = '';

      try {
        this.state = await getDesktopApi().cloudSync.getState();
      } catch (error) {
        this.error = toErrorMessage(error);
      } finally {
        this.isLoading = false;
      }
    },
    async signIn(provider: CloudProvider) {
      if (this.busy) return;

      this.busy = provider;
      this.error = '';

      try {
        const result = await getDesktopApi().cloudSync.beginAuth({ provider });

        if (!result.ok) {
          // 作者自己按的取消不是错误；超时与拒绝才是需要看见的结局。
          if (result.code !== 'canceled') this.error = result.message;
          return;
        }

        await this.load();
        await this.openFolder(provider, null);
      } catch (error) {
        this.error = toErrorMessage(error);
      } finally {
        this.busy = null;
      }
    },
    async cancelSignIn() {
      await getDesktopApi().cloudSync.cancelAuth();
    },
    async signOut(provider: CloudProvider) {
      if (this.busy) return;

      this.busy = provider;
      this.error = '';

      try {
        this.state = await getDesktopApi().cloudSync.signOut({ provider });
        if (this.browseProvider === provider) this.closeFolder();
        if (this.binding?.provider === provider) await this.loadBackups();
      } catch (error) {
        this.error = toErrorMessage(error);
      } finally {
        this.busy = null;
      }
    },
    async openFolder(provider: CloudProvider, parentId: string | null) {
      this.browseProvider = provider;
      this.isListingLoading = true;
      this.listingError = '';

      try {
        const result = await getDesktopApi().cloudSync.listFolders({ provider, parentId });

        if (!result.ok) {
          this.listing = null;
          this.listingError = result.message;
          return;
        }

        this.listing = { current: result.current, parentId: result.parentId, folders: result.folders };
      } catch (error) {
        this.listing = null;
        this.listingError = toErrorMessage(error);
      } finally {
        this.isListingLoading = false;
      }
    },
    closeFolder() {
      this.browseProvider = null;
      this.listing = null;
      this.listingError = '';
    },
    async loadBinding() {
      try {
        const result = await getDesktopApi().cloudSync.getBinding();

        this.binding = result.ok ? result.binding : null;
        this.lastBackupAt = result.ok ? (result.lastBackupAt ?? '') : '';
        this.lastBackupError = result.ok ? result.lastBackupError : null;
        // “没绑定”是正常状态；其他失败（没打开作品、作品缺清单）要留原因给界面说清楚。
        this.bindingError =
          !result.ok && result.code !== 'no-binding' && result.code !== 'no-workspace' ? result.message : '';
      } catch {
        this.binding = null;
        this.lastBackupAt = '';
        this.lastBackupError = null;
        this.bindingError = '';
      }
    },
    /** 绑定、上次备份时间与归档清单一起刷新：这两个界面打开一次就要这几样。 */
    async refreshCloud() {
      await Promise.all([this.loadBinding(), this.loadBackups()]);
    },
    /** 未绑定不是错误：界面据此显示"选一个云端位置"。 */
    async loadBackups() {
      this.isBackupLoading = true;
      this.backupError = '';

      try {
        const result = await getDesktopApi().cloudSync.listBackups();

        if (!result.ok) {
          this.binding = null;
          this.archives = [];
          this.quota = null;
          if (result.code !== 'no-binding') this.backupError = result.message;
          return;
        }

        this.binding = result.binding;
        this.archives = result.archives;
        this.quota = result.quota;
        this.lastBackupError = result.lastBackupError;
      } catch (error) {
        this.backupError = toErrorMessage(error);
      } finally {
        this.isBackupLoading = false;
      }
    },
    async bind(provider: CloudProvider, folderId: string | null, folderName: string) {
      this.backupError = '';
      this.notice = '';

      try {
        const result = await getDesktopApi().cloudSync.bind({ provider, folderId, folderName });

        if (!result.ok) {
          this.backupError = result.message;
          return false;
        }

        await this.refreshCloud();
        this.closeFolder();
        this.notice = `已绑定云端备份位置：${result.binding.folderName}`;

        return true;
      } catch (error) {
        this.backupError = toErrorMessage(error);
        return false;
      }
    },
    async unbind() {
      this.backupError = '';
      this.notice = '';

      try {
        const result = await getDesktopApi().cloudSync.unbind();

        if (!result.ok) {
          this.backupError = result.message;
          return;
        }

        this.binding = null;
        this.archives = [];
        this.quota = null;
        this.notice = '已解除这部作品的云端绑定；云端归档不会被删除';
      } catch (error) {
        this.backupError = toErrorMessage(error);
      }
    },
    async createBackup() {
      if (this.isBackupRunning) return;

      this.isBackupRunning = true;
      this.backupError = '';
      this.notice = '';
      this.progress = { phase: 'packing', done: 0, total: 0 };

      try {
        const result = await getDesktopApi().cloudSync.createBackup();

        if (!result.ok) {
          this.backupError = result.message;
          return;
        }

        this.notice = `已备份 ${result.files} 个文件（${formatSize(result.bytes)}）`;
        await this.refreshCloud();
      } catch (error) {
        this.backupError = toErrorMessage(error);
      } finally {
        this.isBackupRunning = false;
        this.progress = null;
      }
    },
    /**
     * 打开恢复向导并算出这次会动哪些文件。
     *
     * 计划由主进程算出，界面只展示；一个字节都不会因为“点开向导”而变化。
     */
    async openRestore(archiveId: string, archiveName: string) {
      this.backupError = '';
      this.notice = '';
      this.isPlanLoading = true;
      this.wizard = null;

      try {
        const result = await getDesktopApi().cloudSync.planRestore({ archiveId });

        if (!result.ok) {
          this.backupError = result.message;
          return;
        }

        this.wizard = {
          archiveId,
          archiveName,
          plan: result.plan,
          // 新增是零风险的默认模式：原地覆盖得由作者主动点。
          mode: 'new',
          choices: {},
          diff: null,
          receipt: null
        };
      } catch (error) {
        this.backupError = toErrorMessage(error);
      } finally {
        this.isPlanLoading = false;
      }
    },
    /** 关掉向导：没执行过就把已下载的待用归档删掉，作品目录本来就没动过。 */
    async closeRestore() {
      const wizard = this.wizard;

      this.wizard = null;

      if (!wizard || wizard.receipt) return;

      try {
        await getDesktopApi().cloudSync.cancelRestore();
      } catch {
        // 取消失败只影响缓存回收，不把作者的取消动作变成一条错误。
      }
    },
    setRestoreMode(mode: CloudRestoreMode) {
      if (this.wizard) this.wizard.mode = mode;
    },
    setRestoreChoice(relativePath: string, choice: CloudRestoreChoice) {
      if (this.wizard) this.wizard.choices = { ...this.wizard.choices, [relativePath]: choice };
    },
    /** 一组（如应用数据）统一决议：仍是作者显式选择，只是不必逐个点。 */
    setRestoreChoices(relativePaths: string[], choice: CloudRestoreChoice) {
      const wizard = this.wizard;

      if (!wizard) return;

      const choices = { ...wizard.choices };

      for (const relativePath of relativePaths) {
        choices[relativePath] = choice;
      }

      wizard.choices = choices;
    },
    async loadRestoreDiff(relativePath: string) {
      const wizard = this.wizard;

      if (!wizard) return;

      if (wizard.diff?.relativePath === relativePath) {
        wizard.diff = null;

        return;
      }

      try {
        const result = await getDesktopApi().cloudSync.readRestoreDiff({
          archiveId: wizard.archiveId,
          relativePath
        });

        wizard.diff = result.ok ? { ...result, relativePath } : null;

        if (!result.ok) this.backupError = result.message;
      } catch (error) {
        this.backupError = toErrorMessage(error);
      }
    },
    /**
     * 执行恢复。
     *
     * 走之前再查一遍硬拦截（虽然界面已经把入口禁掉了），并把本次真正写下的路径
     * 交给编辑器：干净的 tab 重新读盘，脏的保留缓冲并标冲突（`refreshDocuments` 既有语义）。
     */
    async applyRestore() {
      const wizard = this.wizard;

      if (!wizard || this.isApplying || wizard.receipt) return;
      if (this.restoreBlockedReason) return;

      this.isApplying = true;
      this.backupError = '';

      try {
        const result = await getDesktopApi().cloudSync.applyRestore({
          archiveId: wizard.archiveId,
          mode: wizard.mode,
          // 跨 IPC 前先脱响应式：Vue 的 Proxy 过不了结构化克隆，真机上是
          // “An object could not be cloned”，而本地测试拿 mock 收参数看不出来。
          ...(wizard.mode === 'merge' ? { choices: structuredClone(toRaw(wizard.choices)) } : {})
        });

        if (!result.ok) {
          this.backupError = result.message;
          return;
        }

        wizard.receipt = result;
        await this.refreshCloud();
        await this.refreshRestoredTabs(result.writtenPaths);
      } catch (error) {
        this.backupError = toErrorMessage(error);
      } finally {
        this.isApplying = false;
      }
    },
    /**
     * 编辑器协同：只把改动过的路径交给已有的重载链路。
     *
     * 不另写一套“恢复后重载”：`refreshDocuments` 已经把两条边界定好了——
     * 干净 tab 重新读盘，**脏 tab 一律不覆盖**、保留缓冲并标外部变更。
     */
    async refreshRestoredTabs(writtenPaths: string[]) {
      if (writtenPaths.length === 0) return;

      const editor = useEditorStore();
      const ids = editor.tabs.filter(tab => writtenPaths.includes(tab.path)).map(tab => tab.id);

      if (ids.length > 0) await editor.refreshDocuments(ids);
    },
    /** 只由界面上显式确认的删除调用；没有任何自动路径会走到这里。 */
    async removeBackup(archiveId: string) {
      this.backupError = '';
      this.notice = '';

      try {
        const result = await getDesktopApi().cloudSync.removeBackup({ archiveId });

        if (!result.ok) {
          this.backupError = result.message;
          return;
        }

        this.notice = '已从云端删除该归档';
        await this.loadBackups();
      } catch (error) {
        this.backupError = toErrorMessage(error);
      }
    },
    applyProgress(progress: CloudBackupProgress) {
      this.progress = progress;
    }
  }
});

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 时间文案：今天只给时分，跨天补日期；它是给“要不要再备一次”看的，不需要年份。 */
export function formatWhen(value: string): string {
  const at = new Date(value);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return at.toDateString() === new Date().toDateString() ? time : `${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
}

/**
 * 把自动备份的间隔翻成人话。
 *
 * 1440 分钟到底是多久不该让作者自己除：设置里填的是分钟（能精确到分钟），
 * 而“每天一次”才是他脑子里想的那个东西。
 */
export function describeBackupInterval(minutes: number): string {
  if (minutes < 60) return `每 ${minutes} 分钟一次`;
  if (minutes % 1440 === 0) return minutes === 1440 ? '每天一次' : `每 ${minutes / 1440} 天一次`;
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时一次`;

  // 不是整小时也不是整天：老实说成分钟，不假装成“约一小时”。
  return `每 ${minutes} 分钟一次`;
}

/**
 * 间隔是不是一个“能落盘”的值：整数、且在 30 分钟到 30 天之间。
 *
 * 与合约里那个 validator 同一个口径：它守的是 IPC 入口，这里守的是输入框——
 * 数字输入框在打字过程中会吐出暂态值（打 1440 的中途先出来 1、14），
 * 那些值不能发出去，否则每敲一个键就是一次“IPC 参数无效”。
 */
export function isValidBackupInterval(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AUTO_BACKUP_INTERVAL_MINUTES.min &&
    value <= AUTO_BACKUP_INTERVAL_MINUTES.max
  );
}
