import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

import type { WorkspaceEntryInfo } from '@chaptale/ipc-contract';

import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useNotificationStore } from '@/features/notifications';
import { useWorkbenchStore } from '@/features/workbench';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useFileTreeStore } from './file-tree/store';
import { useWorkspaceStore } from './store';

export const useWorkspaceActions = defineStore('workspace-actions', () => {
  const workspace = useWorkspaceStore();
  const editor = useEditorStore();
  const library = useLibraryStore();
  const tree = useFileTreeStore();
  const pending = ref<{
    action: 'rename' | 'move' | 'duplicate' | 'trash';
    entry: WorkspaceEntryInfo;
    rootPath: string;
  } | null>(null);
  const destination = ref('');
  const error = ref('');
  const busy = ref(false);
  const affectedLinks = computed(() =>
    pending.value
      ? library.assets.filter(asset =>
          asset.links.some(
            link =>
              link.targetPath === pending.value!.entry.relativePath ||
              link.targetPath?.startsWith(`${pending.value!.entry.relativePath}/`)
          )
        )
      : []
  );
  async function prepare(action: 'rename' | 'move' | 'duplicate' | 'trash', relativePath: string) {
    const rootPath = workspace.rootPath;
    if (!rootPath || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      const result = await getDesktopApi().workspace.inspectEntry({ rootPath, relativePath });
      if (rootPath !== workspace.rootPath) return;
      if (!result.ok) throw new Error(result.message);
      if (result.entry.protectedReason) throw new Error(result.entry.protectedReason);
      const name = relativePath.split('/').at(-1)!;
      destination.value =
        action === 'rename'
          ? name
          : action === 'duplicate'
            ? relativePath.replace(/(\.[^/.]+)?$/, '-副本$1')
            : relativePath;
      pending.value = { action, entry: result.entry, rootPath };
      if (!library.snapshot) await library.load();
    } catch (cause) {
      useNotificationStore().error('文件操作无法开始', toErrorMessage(cause));
    } finally {
      busy.value = false;
    }
  }
  async function apply() {
    const request = pending.value;
    if (!request || busy.value || request.rootPath !== workspace.rootPath) return;
    busy.value = true;
    error.value = '';
    try {
      let version = request.entry.version;
      if (request.action !== 'duplicate') {
        const affected = editor.pathTabs(request.entry.relativePath);
        const hadUnsaved = affected.some(tab => tab.dirty || tab.saving);
        if (!(await editor.confirmClose(affected.map(tab => tab.id)))) return;
        if (hadUnsaved) {
          const current = await getDesktopApi().workspace.inspectEntry({
            rootPath: request.rootPath,
            relativePath: request.entry.relativePath
          });
          if (!current.ok) throw new Error(current.message);
          version = current.entry.version;
        }
      }
      const directory = request.entry.relativePath.split('/').slice(0, -1).join('/');
      const targetPath =
        request.action === 'rename' ? [directory, destination.value].filter(Boolean).join('/') : destination.value;
      const result = await getDesktopApi().workspace.mutateEntry({
        rootPath: request.rootPath,
        relativePath: request.entry.relativePath,
        expectedVersion: version,
        operation: request.action === 'rename' ? 'move' : request.action,
        ...(request.action !== 'trash' ? { targetPath } : {})
      });
      if (!result.ok) throw new Error(result.message);
      if (request.rootPath !== workspace.rootPath) return;
      if (request.action === 'trash') editor.acceptPathRemoval(request.entry.relativePath);
      else if (request.action !== 'duplicate' && result.relativePath)
        editor.acceptPathMove(request.entry.relativePath, result.relativePath);
      pending.value = null;
      await tree.reload();
      await library.refresh();
      if (result.relativePath) {
        tree.selectedPath = result.relativePath;
        const parent = result.relativePath.split('/').slice(0, -1).join('/');
        if (parent) await tree.expand(parent);
        if (request.action === 'duplicate') await editor.openDocument(result.relativePath);
      }
    } catch (cause) {
      error.value = toErrorMessage(cause);
    } finally {
      busy.value = false;
    }
  }
  async function reveal(relativePath = '') {
    if (!workspace.rootPath) return;
    try {
      await getDesktopApi().workspace.revealEntry({ rootPath: workspace.rootPath, relativePath });
    } catch (cause) {
      useNotificationStore().error('打开文件位置失败', toErrorMessage(cause));
    }
  }
  async function copyPath(relativePath: string, absolute = false) {
    try {
      await navigator.clipboard.writeText(
        absolute ? `${workspace.rootPath?.replace(/[\\/]+$/, '')}/${relativePath}` : relativePath
      );
    } catch (cause) {
      useNotificationStore().error('复制路径失败', toErrorMessage(cause));
    }
  }
  function askAgent(relativePath: string) {
    if (!workspace.rootPath) return;
    useWorkbenchStore().askAgent(workspace.rootPath, `请围绕《${relativePath}》协助创作。`, [
      `${workspace.rootPath.replace(/[\\/]+$/, '')}/${relativePath}`
    ]);
  }
  watch(
    () => workspace.revision,
    () => {
      pending.value = null;
      error.value = '';
    }
  );
  return { pending, destination, error, busy, affectedLinks, prepare, apply, reveal, copyPath, askAgent };
});
