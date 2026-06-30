import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ChatMessage } from '@chaptale/shared';

type StreamAgentHandlers = {
  onMessage: (message: ChatMessage) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

const desktopApi = {
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  agent: {
    getHistory: () => ipcRenderer.invoke('agent:get-history') as Promise<ChatMessage[]>,
    stream: async (query: string, handlers: StreamAgentHandlers) => {
      const runId = crypto.randomUUID();

      const cleanup = () => {
        ipcRenderer.removeListener('agent:message', handleMessage);
        ipcRenderer.removeListener('agent:done', handleDone);
        ipcRenderer.removeListener('agent:error', handleError);
      };

      const handleMessage = (_event: IpcRendererEvent, event: { runId: string; message: ChatMessage }) => {
        if (event.runId === runId) {
          handlers.onMessage(event.message);
        }
      };

      const handleDone = (_event: IpcRendererEvent, event: { runId: string }) => {
        if (event.runId !== runId) {
          return;
        }

        cleanup();
        handlers.onDone?.();
      };

      const handleError = (_event: IpcRendererEvent, event: { runId: string; message: string }) => {
        if (event.runId !== runId) {
          return;
        }

        cleanup();
        handlers.onError?.(event.message);
      };

      ipcRenderer.on('agent:message', handleMessage);
      ipcRenderer.on('agent:done', handleDone);
      ipcRenderer.on('agent:error', handleError);

      await ipcRenderer.invoke('agent:start', { runId, query });
      return { runId };
    },
    cancel: (runId: string) => ipcRenderer.invoke('agent:cancel', runId) as Promise<{ runId: string }>
  }
};

contextBridge.exposeInMainWorld('chaptaleDesktop', desktopApi);

export type ChaptaleDesktopApi = typeof desktopApi;
