import { toRaw } from 'vue';

import type { CloudRestoreChoice, CloudRestoreMode } from '@chaptale/ipc-contract';

import { useEditorStore } from '@/features/editor';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import type { CloudSyncStoreContext } from './types';

export const cloudRestoreActions = {
  /**
   * 打开恢复向导并算出这次会动哪些文件。
   *
   * 计划由主进程算出，界面只展示；一个字节都不会因为“点开向导”而变化。
   */
  async openRestore(this: CloudSyncStoreContext, archiveId: string, archiveName: string) {
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
  async closeRestore(this: CloudSyncStoreContext) {
    const wizard = this.wizard;
    this.wizard = null;
    if (!wizard || wizard.receipt) return;
    try {
      await getDesktopApi().cloudSync.cancelRestore();
    } catch {
      // 取消失败只影响缓存回收，不把作者的取消动作变成一条错误。
    }
  },
  setRestoreMode(this: CloudSyncStoreContext, mode: CloudRestoreMode) {
    if (this.wizard) this.wizard.mode = mode;
  },
  setRestoreChoice(this: CloudSyncStoreContext, relativePath: string, choice: CloudRestoreChoice) {
    if (this.wizard) this.wizard.choices = { ...this.wizard.choices, [relativePath]: choice };
  },
  /** 一组（如应用数据）统一决议：仍是作者显式选择，只是不必逐个点。 */
  setRestoreChoices(this: CloudSyncStoreContext, relativePaths: string[], choice: CloudRestoreChoice) {
    const wizard = this.wizard;
    if (!wizard) return;
    const choices = { ...wizard.choices };
    for (const relativePath of relativePaths) {
      choices[relativePath] = choice;
    }
    wizard.choices = choices;
  },
  async loadRestoreDiff(this: CloudSyncStoreContext, relativePath: string) {
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
  async applyRestore(this: CloudSyncStoreContext) {
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
  async refreshRestoredTabs(this: CloudSyncStoreContext, writtenPaths: string[]) {
    if (writtenPaths.length === 0) return;
    const editor = useEditorStore();
    const ids = editor.tabs.filter(tab => writtenPaths.includes(tab.path)).map(tab => tab.id);
    if (ids.length > 0) await editor.refreshDocuments(ids);
  }
};
