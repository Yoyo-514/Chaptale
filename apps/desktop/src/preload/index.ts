import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { contextBridge, ipcRenderer } from 'electron';

import type {
  AgentDoneEvent,
  AgentErrorEvent,
  AgentMessageEvent,
  AgentRunResult,
  AgentStartPayload,
  AppPlatformResult,
  ChaptaleDesktopApi,
  CreateSessionOptions,
  WindowStateResult
} from '@chaptale/ipc-contract';
import type { IpcRendererEvent } from 'electron';

const desktopApi: ChaptaleDesktopApi = {
  getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.app.getPlatform) as Promise<AppPlatformResult>,
  windowControl: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.window.minimize) as Promise<WindowStateResult>,
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.window.toggleMaximize) as Promise<WindowStateResult>,
    close: () => ipcRenderer.invoke(IPC_CHANNELS.window.close) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.window.isMaximized) as Promise<WindowStateResult>
  },
  session: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.session.list),
    create: (options?: CreateSessionOptions) => ipcRenderer.invoke(IPC_CHANNELS.session.create, options),
    getEntries: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.session.getEntries, sessionId),
    getMessages: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.session.getMessages, sessionId),
    rename: (sessionId: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.session.rename, { sessionId, name }),
    delete: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.session.delete, { sessionId }) as Promise<void>,
    setLeaf: (sessionId: string, leafId: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.session.setLeaf, { sessionId, leafId }) as Promise<void>,
    getStorageDebugInfo: () => ipcRenderer.invoke(IPC_CHANNELS.session.getStorageDebugInfo),
    openStorageDir: () => ipcRenderer.invoke(IPC_CHANNELS.session.openStorageDir) as Promise<void>
  },
  agent: {
    getHistory: (sessionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.agent.getHistory, { sessionId }),
    stream: async (query, handlers, sessionId) => {
      const runId = crypto.randomUUID();

      const cleanup = () => {
        ipcRenderer.removeListener(IPC_CHANNELS.agent.message, handleMessage);
        ipcRenderer.removeListener(IPC_CHANNELS.agent.done, handleDone);
        ipcRenderer.removeListener(IPC_CHANNELS.agent.error, handleError);
      };

      const handleMessage = (_event: IpcRendererEvent, event: AgentMessageEvent) => {
        if (event.runId === runId) {
          handlers.onMessage(event.message);
        }
      };

      const handleDone = (_event: IpcRendererEvent, event: AgentDoneEvent) => {
        if (event.runId !== runId) {
          return;
        }

        cleanup();
        handlers.onDone?.();
      };

      const handleError = (_event: IpcRendererEvent, event: AgentErrorEvent) => {
        if (event.runId !== runId) {
          return;
        }

        cleanup();
        handlers.onError?.(event.message);
      };

      ipcRenderer.on(IPC_CHANNELS.agent.message, handleMessage);
      ipcRenderer.on(IPC_CHANNELS.agent.done, handleDone);
      ipcRenderer.on(IPC_CHANNELS.agent.error, handleError);

      await ipcRenderer.invoke(IPC_CHANNELS.agent.start, { runId, query, sessionId } satisfies AgentStartPayload);
      return { runId };
    },
    cancel: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.agent.cancel, runId) as Promise<AgentRunResult>
  }
};

contextBridge.exposeInMainWorld('chaptaleDesktop', desktopApi);

export type { ChaptaleDesktopApi };
