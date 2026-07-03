import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { contextBridge, ipcRenderer } from 'electron';

import type {
  AgentDoneEvent,
  AgentErrorEvent,
  AgentMessageEvent,
  AgentRunResult,
  AgentStartPayload,
  AppPlatformResult,
  ChaptaleDesktopApi
} from '@chaptale/ipc-contract';
import type { IpcRendererEvent } from 'electron';

const desktopApi: ChaptaleDesktopApi = {
  getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.app.getPlatform) as Promise<AppPlatformResult>,
  agent: {
    getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.agent.getHistory),
    stream: async (query, handlers) => {
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

      await ipcRenderer.invoke(IPC_CHANNELS.agent.start, { runId, query } satisfies AgentStartPayload);
      return { runId };
    },
    cancel: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.agent.cancel, runId) as Promise<AgentRunResult>
  }
};

contextBridge.exposeInMainWorld('chaptaleDesktop', desktopApi);

export type { ChaptaleDesktopApi };
