import { ipcRenderer } from 'electron';

import { WorkspaceChangedValidator, type ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

import { onValidatedEvent } from './validated-event';

export function createWorkspaceApi(): ChaptaleDesktopApi['workspace'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.workspace.getState),
    selectParent: () => ipcRenderer.invoke(IPC_CHANNELS.workspace.selectParent),
    createWorkspace: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.createWorkspace, args),
    inspectEntry: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.inspectEntry, args),
    mutateEntry: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.mutateEntry, args),
    revealEntry: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.revealEntry, args),
    listDirectory: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.listDirectory, args),
    createEntry: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.createEntry, args),
    readDocument: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.readDocument, args),
    writeDocument: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.writeDocument, args),
    getLayout: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.getLayout, args),
    createChapter: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.createChapter, args),
    onChanged: listener => onValidatedEvent(IPC_CHANNELS.workspace.changed, WorkspaceChangedValidator, listener),
    listRecoveries: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.listRecoveries, args),
    readRecovery: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.readRecovery, args),
    saveRecovery: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.saveRecovery, args),
    discardRecovery: args => ipcRenderer.invoke(IPC_CHANNELS.workspace.discardRecovery, args)
  };
}
