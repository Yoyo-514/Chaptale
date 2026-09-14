import { ipcRenderer } from 'electron';

import type {
  ChaptaleDesktopApi,
  CloudArchiveArgs,
  CloudArchiveListArgs,
  CloudBackupProgress,
  CloudBindArgs,
  CloudListFoldersArgs,
  CloudProviderArgs,
  CloudRestoreArgs,
  CloudRestoreDiffArgs
} from '@chaptale/ipc-contract';
import { CloudBackupProgressValidator } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

import { onValidatedEvent } from './validated-event';

export function createCloudSyncApi(): ChaptaleDesktopApi['cloudSync'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.getState),
    getBinding: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.getBinding),
    beginAuth: (args: CloudProviderArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.beginAuth, args),
    cancelAuth: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.cancelAuth),
    signOut: (args: CloudProviderArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.signOut, args),
    listFolders: (args: CloudListFoldersArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.listFolders, args),
    bind: (args: CloudBindArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.bind, args),
    unbind: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.unbind),
    listBackups: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.listBackups),
    createBackup: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.createBackup),
    planRestore: (args: CloudArchiveArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.planRestore, args),
    readRestoreDiff: (args: CloudRestoreDiffArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.readRestoreDiff, args),
    applyRestore: (args: CloudRestoreArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.applyRestore, args),
    cancelRestore: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.cancelRestore),
    removeBackups: (args: CloudArchiveListArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.removeBackups, args),
    onBackupProgress: (listener: (progress: CloudBackupProgress) => void) =>
      onValidatedEvent(IPC_CHANNELS.cloudSync.backupProgress, CloudBackupProgressValidator, listener)
  };
}
