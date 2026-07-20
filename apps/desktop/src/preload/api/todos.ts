import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { ChaptaleDesktopApi, TodosUpdatedEvent } from '@chaptale/ipc-contract';
import { ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

export function createTodosApi(): ChaptaleDesktopApi['todos'] {
  return {
    get: sessionId => ipcRenderer.invoke(IPC_CHANNELS.todos.get, sessionId),
    onUpdated: listener => {
      const handler = (_event: IpcRendererEvent, payload: TodosUpdatedEvent) => {
        listener(payload);
      };

      ipcRenderer.on(IPC_CHANNELS.todos.updated, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.todos.updated, handler);
      };
    }
  };
}
