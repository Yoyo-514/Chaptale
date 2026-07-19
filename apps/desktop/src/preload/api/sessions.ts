import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type {
  ChaptaleDesktopApi,
  CreateSessionOptions,
  ReadSessionImagePayload,
  ReadSessionImageResult
} from '@chaptale/ipc-contract';
import { ipcRenderer } from 'electron';

/** 为 Renderer 提供会话读写、分支、导出及图片读取的最小 IPC 门面。 */
export function createSessionApi(): ChaptaleDesktopApi['session'] {
  return {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.session.list),
    create: (options?: CreateSessionOptions) => ipcRenderer.invoke(IPC_CHANNELS.session.create, options),
    getEntries: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.session.getEntries, sessionId),
    getMessages: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.session.getMessages, sessionId),
    readImage: (payload: ReadSessionImagePayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.session.readImage, payload) as Promise<ReadSessionImageResult>,
    rename: (sessionId: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.session.rename, { sessionId, name }),
    exportHtml: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.session.exportHtml, { sessionId }) as Promise<string | null>,
    delete: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.session.delete, { sessionId }) as Promise<void>,
    deleteMany: (sessionIds: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.session.deleteMany, { sessionIds }) as Promise<void>,
    setLeaf: (sessionId: string, leafId: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.session.setLeaf, { sessionId, leafId }) as Promise<void>,
    getStorageDebugInfo: () => ipcRenderer.invoke(IPC_CHANNELS.session.getStorageDebugInfo),
    openStorageDir: () => ipcRenderer.invoke(IPC_CHANNELS.session.openStorageDir) as Promise<void>
  };
}
