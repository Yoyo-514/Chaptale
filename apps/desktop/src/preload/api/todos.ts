import type { IpcRendererEvent } from 'electron';
import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi, TodosUpdatedEvent } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

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
