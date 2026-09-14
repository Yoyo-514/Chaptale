import { ref, shallowRef } from 'vue';

import type { RecoverySummary } from '@chaptale/ipc-contract';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { DocumentBuffer } from '../codemirror/document-buffer';
import type { EditorDocumentContext } from './context';

type RecoveryContext = EditorDocumentContext & {
  openDocument: (path: string) => Promise<void>;
  confirmClose: (ids: string[]) => Promise<boolean>;
  updateBuffer: (id: string, buffer: DocumentBuffer) => void;
};

/** 恢复稿的调度、串行落盘与重新载入；不负责正文保存或窗口关闭决策。 */
export function createDocumentRecovery(context: RecoveryContext) {
  const { tabs, buffers, workspace, replaceTab } = context;
  const recoveries = shallowRef<RecoverySummary[]>([]);
  const recoveryError = ref('');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const writes = new Map<string, Promise<void>>();
  let generation = 0;

  function cancelScheduled(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }

  function schedule(id: string) {
    cancelScheduled(id);
    timers.set(
      id,
      setTimeout(() => void persistRecovery(id), 500)
    );
  }

  async function queueWrite(rootPath: string, relativePath: string, action: () => Promise<void>) {
    // 以文件身份串行化，关闭标签后重新打开也不能让旧写入覆盖较新的恢复稿。
    const key = JSON.stringify([rootPath, relativePath]);
    const next = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
    writes.set(key, next);
    try {
      await next;
    } finally {
      if (writes.get(key) === next) writes.delete(key);
    }
  }

  async function persistRecovery(id: string) {
    cancelScheduled(id);
    const tab = tabs.value.find(item => item.id === id);
    const buffer = buffers.get(id);
    if (!tab?.document || !buffer) return;
    const { rootPath } = tab.document;
    const revision = workspace.revision;
    const args = {
      rootPath,
      relativePath: tab.path,
      expectedHash: tab.recoveryBaseHash ?? tab.document.contentHash,
      content: buffer.content
    };
    const dirty = buffer.dirty;
    let message = '';
    try {
      await queueWrite(rootPath, tab.path, () =>
        dirty
          ? getDesktopApi().workspace.saveRecovery(args)
          : getDesktopApi().workspace.discardRecovery({ rootPath, relativePath: tab.path })
      );
    } catch (error) {
      message = `恢复草稿未写入：${toErrorMessage(error)}`;
    }
    if (workspace.rootPath !== rootPath || workspace.revision !== revision) return;
    const current = tabs.value.find(item => item.id === id);
    if (current && buffers.get(id) === buffer) replaceTab({ ...current, recoveryError: message });
  }

  async function loadRecoveries() {
    const token = ++generation;
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    try {
      const list = (await getDesktopApi().workspace.listRecoveries?.({ rootPath })) ?? [];
      if (token === generation && rootPath === workspace.rootPath) {
        recoveries.value = list;
        recoveryError.value = '';
      }
    } catch (error) {
      if (token === generation) recoveryError.value = toErrorMessage(error);
    }
  }

  async function discardRecovery(relativePath: string, id = relativePath) {
    cancelScheduled(id);
    const { rootPath, revision } = workspace;
    if (!rootPath) return;
    try {
      await queueWrite(rootPath, relativePath, () =>
        getDesktopApi().workspace.discardRecovery({ rootPath, relativePath })
      );
      if (workspace.rootPath === rootPath && workspace.revision === revision) {
        recoveries.value = recoveries.value.filter(item => item.relativePath !== relativePath);
      }
    } catch (error) {
      if (workspace.rootPath === rootPath && workspace.revision === revision)
        recoveryError.value = toErrorMessage(error);
    }
  }

  async function restoreRecovery(relativePath: string) {
    const { rootPath, revision } = workspace;
    if (!rootPath) return;
    const isCurrent = () => workspace.rootPath === rootPath && workspace.revision === revision;
    try {
      const draft = await getDesktopApi().workspace.readRecovery({ rootPath, relativePath });
      if (!draft || !isCurrent()) return;
      const existing = tabs.value.find(tab => tab.path === relativePath);
      if (existing?.dirty && !(await context.confirmClose([existing.id]))) return;
      if (!isCurrent()) return;
      await context.openDocument(relativePath);
      const tab = tabs.value.find(item => item.path === relativePath);
      if (!tab || !isCurrent()) return;
      const disk = tab.document;
      const document = disk ?? {
        rootPath,
        relativePath,
        content: '',
        head: { status: 'none' as const, body: '' },
        contentHash: draft.expectedHash,
        mtimeMs: 0,
        sizeBytes: 0
      };
      const buffer = buffers.get(tab.id) ?? new DocumentBuffer(document.content);
      buffers.set(tab.id, buffer);
      buffer.replaceContent(draft.content);
      replaceTab({
        ...tab,
        document,
        status: 'ready',
        error: null,
        readonly: false,
        dirty: buffer.dirty,
        recoveryBaseHash: draft.expectedHash,
        external:
          disk && disk.contentHash === draft.expectedHash
            ? undefined
            : disk
              ? { ok: true, document: disk }
              : { ok: false, code: 'not-found', message: '原文件已不存在，恢复稿仍保留，可另存副本' },
        notice: '已恢复上次未保存的草稿'
      });
      context.updateBuffer(tab.id, buffer);
      recoveries.value = recoveries.value.filter(item => item.relativePath !== relativePath);
    } catch (error) {
      if (isCurrent()) recoveryError.value = toErrorMessage(error);
    }
  }

  function reset() {
    generation += 1;
    for (const id of timers.keys()) cancelScheduled(id);
    recoveries.value = [];
    recoveryError.value = '';
    // 已发出的写入仍需完成并释放队列，不能清空后允许同一文件并发写。
  }

  return {
    recoveries,
    recoveryError,
    schedule,
    cancelScheduled,
    persistRecovery,
    loadRecoveries,
    discardRecovery,
    restoreRecovery,
    reset
  };
}
