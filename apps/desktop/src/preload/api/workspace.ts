import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

export function createWorkspaceApi(): ChaptaleDesktopApi['workspace'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.workspace.getState),
    listDirectory: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.listDirectory, args),
    createEntry: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.createEntry, args),
    readDocument: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.readDocument, args)
  };
}
