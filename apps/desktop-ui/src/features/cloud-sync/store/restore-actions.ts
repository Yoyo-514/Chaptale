import { toRaw } from 'vue';

import type { CloudRestoreChoice, CloudRestoreMode } from '@chaptale/ipc-contract';

import { useEditorStore } from '@/features/editor';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import type { CloudSyncStoreContext } from './types';

export const cloudRestoreActions = {
  async openRestore(this: CloudSyncStoreContext, archiveId: string, archiveName: string) {
    if (this.isApplying) return;
    const request = ++this.restoreRequest;
    const workspace = useWorkspaceStore();
    const scope = { rootPath: workspace.rootPath, revision: workspace.revision };
    this.backupError = '';
    this.notice = '';
    this.isPlanLoading = true;
    this.wizard = null;
    try {
      const result = await getDesktopApi().cloudSync.planRestore({ archiveId });
      if (
        request !== this.restoreRequest ||
        scope.rootPath !== workspace.rootPath ||
        scope.revision !== workspace.revision
      ) {
        if (!this.wizard && (!this.isPlanLoading || request === this.restoreRequest)) {
          await getDesktopApi().cloudSync.cancelRestore();
        }
        return;
      }
      if (!result.ok) {
        this.backupError = result.message;
        return;
      }
      this.wizard = {
        archiveId,
        archiveName,
        plan: result.plan,
        mode: 'new',
        choices: {},
        diff: null,
        receipt: null,
        workspace: scope
      };
    } catch (error) {
      if (request === this.restoreRequest) this.backupError = toErrorMessage(error);
    } finally {
      if (request === this.restoreRequest) this.isPlanLoading = false;
    }
  },

  async closeRestore(this: CloudSyncStoreContext) {
    if (this.isApplying) return;
    const needsCleanup = this.isPlanLoading || (this.wizard && !this.wizard.receipt);
    ++this.restoreRequest;
    ++this.diffRequest;
    this.wizard = null;
    this.isPlanLoading = false;
    if (!needsCleanup) return;
    try {
      await getDesktopApi().cloudSync.cancelRestore();
    } catch {
      // 只影响缓存回收；不把关闭动作变成一条错误。
    }
  },

  setRestoreMode(this: CloudSyncStoreContext, mode: CloudRestoreMode) {
    if (this.wizard && !this.isApplying) this.wizard.mode = mode;
  },

  setRestoreChoice(this: CloudSyncStoreContext, relativePath: string, choice: CloudRestoreChoice) {
    if (this.wizard && !this.isApplying) this.wizard.choices = { ...this.wizard.choices, [relativePath]: choice };
  },

  setRestoreChoices(this: CloudSyncStoreContext, relativePaths: string[], choice: CloudRestoreChoice) {
    if (!this.wizard || this.isApplying) return;
    const choices = { ...this.wizard.choices };
    for (const relativePath of relativePaths) choices[relativePath] = choice;
    this.wizard.choices = choices;
  },

  async loadRestoreDiff(this: CloudSyncStoreContext, relativePath: string) {
    const wizard = this.wizard;
    if (!wizard || this.isApplying) return;
    const request = ++this.diffRequest;
    if (wizard.diff?.relativePath === relativePath) {
      wizard.diff = null;
      return;
    }
    try {
      const result = await getDesktopApi().cloudSync.readRestoreDiff({ archiveId: wizard.archiveId, relativePath });
      if (this.wizard !== wizard || request !== this.diffRequest) return;
      wizard.diff = result.ok ? { ...result, relativePath } : null;
      if (!result.ok) this.backupError = result.message;
    } catch (error) {
      if (this.wizard === wizard && request === this.diffRequest) this.backupError = toErrorMessage(error);
    }
  },

  async applyRestore(this: CloudSyncStoreContext) {
    const wizard = this.wizard;
    if (!wizard || this.isApplying || wizard.receipt || this.restoreBlockedReason) return;
    const workspace = useWorkspaceStore();
    const scope = { rootPath: workspace.rootPath, revision: workspace.revision };
    this.isApplying = true;
    this.backupError = '';
    try {
      const result = await getDesktopApi().cloudSync.applyRestore({
        archiveId: wizard.archiveId,
        mode: wizard.mode,
        ...(wizard.mode === 'merge' ? { choices: structuredClone(toRaw(wizard.choices)) } : {})
      });
      if (this.wizard !== wizard || scope.rootPath !== workspace.rootPath || scope.revision !== workspace.revision)
        return;
      if (!result.ok) {
        this.backupError = result.message;
        return;
      }
      wizard.receipt = result;
      await this.refreshCloud();
      // 新目录没有修改当前作品，不能把同名的当前文档误标为外部冲突。
      if (result.mode !== 'new' && scope.rootPath === workspace.rootPath && scope.revision === workspace.revision) {
        await this.refreshRestoredTabs(result.writtenPaths);
      }
    } catch (error) {
      if (this.wizard === wizard) this.backupError = toErrorMessage(error);
    } finally {
      this.isApplying = false;
    }
  },

  async refreshRestoredTabs(this: CloudSyncStoreContext, writtenPaths: string[]) {
    if (!writtenPaths.length) return;
    const editor = useEditorStore();
    const written = new Set(writtenPaths);
    const ids = editor.tabs.filter(tab => written.has(tab.path)).map(tab => tab.id);
    if (ids.length) await editor.refreshDocuments(ids);
  }
};
