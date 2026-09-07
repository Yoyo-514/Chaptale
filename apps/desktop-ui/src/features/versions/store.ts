import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

import type { WorkspaceDocument } from '@chaptale/ipc-contract';
import type { VersionSnapshot } from '@chaptale/shared';

import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const useVersionStore = defineStore('document-versions', () => {
  const workspace = useWorkspaceStore();
  const editor = useEditorStore();
  const library = useLibraryStore();
  const current = shallowRef<WorkspaceDocument | null>(null);
  const snapshots = shallowRef<VersionSnapshot[]>([]);
  const selected = shallowRef<{ snapshot: VersionSnapshot; content: string } | null>(null);
  const finalizing = shallowRef<WorkspaceDocument | null>(null);
  const error = ref('');
  const busy = ref(false);
  let sequence = 0;
  function savedDocument() {
    const tab = editor.activeTab;
    if (!tab?.document || tab.readonly || tab.dirty || tab.saving || tab.external)
      throw new Error('请先保存文档并处理磁盘变化');
    return tab.document;
  }
  async function select(snapshotId: string) {
    const document = current.value;
    if (!document) return;
    const token = ++sequence;
    selected.value = null;
    try {
      const result = await getDesktopApi().writing.readVersion({
        rootPath: document.rootPath,
        targetPath: document.relativePath,
        snapshotId
      });
      if (token === sequence && current.value === document) selected.value = result;
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    }
  }
  async function open() {
    if (busy.value) return;
    error.value = '';
    try {
      const document = savedDocument();
      current.value = document;
      selected.value = null;
      snapshots.value = [];
      const token = ++sequence;
      const list = await getDesktopApi().writing.listVersions({
        rootPath: document.rootPath,
        targetPath: document.relativePath
      });
      if (token !== sequence || workspace.rootPath !== document.rootPath) return;
      snapshots.value = list;
      if (list[0]) await select(list[0].id);
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }
  function prepareFinal() {
    error.value = '';
    try {
      finalizing.value = savedDocument();
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }
  async function finalize() {
    const document = finalizing.value;
    if (!document || busy.value) return;
    busy.value = true;
    try {
      await editor.acceptDocumentChange(document.relativePath, document.contentHash, async () => ({
        document: await getDesktopApi().writing.finalizeChapter({
          rootPath: document.rootPath,
          targetPath: document.relativePath,
          expectedHash: document.contentHash
        })
      }));
      if (workspace.rootPath !== document.rootPath) return;
      finalizing.value = null;
      error.value = '';
      await library.load();
    } catch (cause) {
      if (workspace.rootPath === document.rootPath) error.value = toErrorMessage(cause);
    } finally {
      if (workspace.rootPath === document.rootPath) busy.value = false;
    }
  }
  async function restore() {
    const document = current.value;
    const version = selected.value;
    if (!document || !version || busy.value) return;
    busy.value = true;
    try {
      const result = await editor.acceptDocumentChange(document.relativePath, document.contentHash, async () => ({
        document: await getDesktopApi().writing.restoreVersion({
          rootPath: document.rootPath,
          targetPath: document.relativePath,
          expectedHash: document.contentHash,
          snapshotId: version.snapshot.id
        })
      }));
      if (workspace.rootPath !== document.rootPath) return;
      current.value = result.document;
      snapshots.value = await getDesktopApi().writing.listVersions({
        rootPath: document.rootPath,
        targetPath: document.relativePath
      });
      error.value = '';
      await library.load();
    } catch (cause) {
      if (workspace.rootPath === document.rootPath) error.value = toErrorMessage(cause);
    } finally {
      if (workspace.rootPath === document.rootPath) busy.value = false;
    }
  }
  watch(
    () => workspace.rootPath,
    () => {
      ++sequence;
      current.value = null;
      snapshots.value = [];
      selected.value = null;
      finalizing.value = null;
      error.value = '';
      busy.value = false;
    }
  );
  return { current, snapshots, selected, finalizing, error, busy, open, select, prepareFinal, finalize, restore };
});
