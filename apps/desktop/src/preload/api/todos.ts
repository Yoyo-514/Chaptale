import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { TodosUpdatedEventValidator } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

import { onValidatedEvent } from './validated-event';

export function createTodosApi(): ChaptaleDesktopApi['todos'] {
  return {
    get: sessionId => ipcRenderer.invoke(IPC_CHANNELS.todos.get, sessionId),
    clear: payload => ipcRenderer.invoke(IPC_CHANNELS.todos.clear, payload),
    onUpdated: listener => onValidatedEvent(IPC_CHANNELS.todos.updated, TodosUpdatedEventValidator, listener)
  };
}
