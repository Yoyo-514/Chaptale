import type { Ref } from 'vue';

import { MAX_DOCUMENT_BYTES, type WorkspaceChanged } from '@chaptale/ipc-contract';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { NORMAL_PREVIEW_BYTES } from '../types';
import type { EditorDocumentContext } from './context';
import type { createDocumentRecovery } from './recovery';

type ExternalChangesContext = EditorDocumentContext & {
  recovery: ReturnType<typeof createDocumentRecovery>;
  conflictId: Ref<string>;
  refreshAfterLoad: Set<string>;
  reloadDocument: (id: string) => Promise<void>;
};

/** 文件监听与冲突处理共用保存队列；迟到的旧作品结果不允许复活标签。 */
export function createExternalChanges(context: ExternalChangesContext) {
  const { tabs, buffers, workspace, saves, autoSaveTimers, recovery, replaceTab, conflictId } = context;
  const reads = new Map<string, symbol>();

  async function handleWorkspaceChanged(event: WorkspaceChanged) {
    if (event.rootPath !== workspace.rootPath) return;
    if (event.error) recovery.recoveryError.value = `文件监听异常：${event.error}`;
    const ids = tabs.value
      .filter(tab =>
        event.changes.some(
          change =>
            change.relativePath === tab.path ||
            (change.type === 'unlinkDir' && (!change.relativePath || tab.path.startsWith(`${change.relativePath}/`)))
        )
      )
      .map(tab => tab.id);
    await refreshDocuments(ids);
  }

  async function refreshDocuments(ids = tabs.value.map(tab => tab.id)) {
    const { rootPath, revision } = workspace;
    if (!rootPath) return;
    for (const tab of tabs.value.filter(item => ids.includes(item.id))) {
      if (workspace.rootPath !== rootPath || workspace.revision !== revision) return;
      if (tab.status === 'loading') {
        context.refreshAfterLoad.add(tab.id);
        continue;
      }
      if (!tab.document) {
        if (!tab.dirty && !tab.saving) await context.reloadDocument(tab.id);
        continue;
      }
      if (saves.has(tab.id)) await saves.get(tab.id);
      const token = Symbol();
      reads.set(tab.id, token);
      const isCurrent = () =>
        workspace.rootPath === rootPath && workspace.revision === revision && reads.get(tab.id) === token;
      try {
        const result = await getDesktopApi().workspace.readDocument({
          rootPath,
          relativePath: tab.path,
          maxBytes: tab.allowLarge ? MAX_DOCUMENT_BYTES : NORMAL_PREVIEW_BYTES
        });
        if (!isCurrent()) continue;
        const current = tabs.value.find(item => item.id === tab.id);
        if (!current?.document) continue;
        if (result.ok && result.document.contentHash === current.document.contentHash) {
          if (current.external) replaceTab({ ...current, external: undefined, saveError: '', notice: '' });
          continue;
        }
        if (!current.dirty && result.ok) {
          buffers.delete(tab.id);
          replaceTab({
            ...current,
            document: result.document,
            generation: (current.generation ?? 0) + 1,
            readonly: result.document.sizeBytes > NORMAL_PREVIEW_BYTES,
            external: undefined,
            saveError: '',
            notice: '已载入磁盘更新'
          });
        } else {
          clearTimeout(autoSaveTimers.get(tab.id));
          replaceTab({
            ...current,
            external: result,
            notice: '',
            saveError: result.ok ? '磁盘文件已更新，本地修改仍保留' : result.message
          });
          if (current.dirty) await recovery.persistRecovery(tab.id);
        }
      } catch (error) {
        const current = tabs.value.find(item => item.id === tab.id);
        if (current && isCurrent()) replaceTab({ ...current, saveError: toErrorMessage(error) });
      } finally {
        if (reads.get(tab.id) === token) reads.delete(tab.id);
      }
    }
  }

  async function acceptExternal(id: string) {
    const tab = tabs.value.find(item => item.id === id);
    if (!tab?.document || tab.saving) return;
    const document = tab.document;
    const { rootPath, revision } = workspace;
    const buffer = buffers.get(id);
    const isCurrent = () =>
      workspace.rootPath === rootPath && workspace.revision === revision && tabs.value.some(item => item.id === id);
    replaceTab({ ...tab, saving: true });
    buffer?.setLocked(true);
    const operation = (async () => {
      try {
        const result = await getDesktopApi().workspace.readDocument({
          rootPath: document.rootPath,
          relativePath: tab.path,
          maxBytes: tab.allowLarge ? MAX_DOCUMENT_BYTES : NORMAL_PREVIEW_BYTES
        });
        if (!isCurrent()) return false;
        if (!result.ok) {
          replaceTab({ ...tab, saving: false, saveError: result.message });
          return false;
        }
        clearTimeout(autoSaveTimers.get(id));
        await recovery.discardRecovery(tab.path, id);
        if (!isCurrent()) return false;
        buffers.delete(id);
        replaceTab({
          ...tab,
          document: result.document,
          external: undefined,
          recoveryBaseHash: undefined,
          readonly: result.document.sizeBytes > NORMAL_PREVIEW_BYTES,
          dirty: false,
          saving: false,
          saveError: '',
          generation: (tab.generation ?? 0) + 1,
          notice: '已采用外部版本'
        });
        conflictId.value = '';
        return true;
      } catch (error) {
        if (isCurrent()) replaceTab({ ...tab, saving: false, saveError: toErrorMessage(error) });
        return false;
      } finally {
        buffer?.setLocked(false);
        saves.delete(id);
      }
    })();
    saves.set(id, operation);
    await operation;
  }

  async function keepLocal(id: string) {
    const tab = tabs.value.find(item => item.id === id);
    const buffer = buffers.get(id);
    if (!tab?.external?.ok || !tab.document || !buffer || tab.saving) return;
    const rootPath = tab.document.rootPath;
    const revision = workspace.revision;
    const expectedHash = tab.external.document.contentHash;
    const sentState = buffer.state;
    const content = buffer.content;
    const isCurrent = () =>
      workspace.rootPath === rootPath && workspace.revision === revision && buffers.get(id) === buffer;
    replaceTab({ ...tab, saving: true });
    const operation = (async (): Promise<boolean> => {
      try {
        const result = await getDesktopApi().workspace.writeDocument({
          rootPath,
          relativePath: tab.path,
          expectedHash,
          content,
          preservePrevious: true
        });
        const current = tabs.value.find(item => item.id === id);
        if (!current || !isCurrent()) return false;
        if (!result.ok) {
          replaceTab({ ...current, saving: false, saveError: result.message });
          return false;
        }
        buffer.markSaved(sentState);
        replaceTab({
          ...current,
          document: result.document,
          external: undefined,
          recoveryBaseHash: undefined,
          dirty: buffer.dirty,
          saving: false,
          saveError: ''
        });
        await recovery.persistRecovery(id);
        if (isCurrent()) conflictId.value = '';
        return true;
      } catch (error) {
        const current = tabs.value.find(item => item.id === id);
        if (current && isCurrent()) replaceTab({ ...current, saving: false, saveError: toErrorMessage(error) });
        return false;
      } finally {
        saves.delete(id);
      }
    })();
    saves.set(id, operation);
    await operation;
  }

  return {
    handleWorkspaceChanged,
    refreshDocuments,
    acceptExternal,
    keepLocal,
    forget: (id: string) => reads.delete(id),
    reset: () => reads.clear()
  };
}
