import { ipcRenderer, type IpcRendererEvent } from 'electron';

import { IPC_CHANNELS } from '../../bridge/channels';
import type { CloudBackupProgress, CloudProviderArgs } from '../../bridge/cloud-sync';
import type { ChaptaleDesktopApi } from '../../bridge/contracts';

export function createCloudSyncApi(): ChaptaleDesktopApi['cloudSync'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.getState),
    beginAuth: (args: CloudProviderArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.beginAuth, args),
    cancelAuth: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.cancelAuth),
    signOut: (args: CloudProviderArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.signOut, args),
    async backupWork(args, onUpload) {
      const channel = IPC_CHANNELS.cloudSync.backupProgress;
      const relay = (_event: IpcRendererEvent, progress: CloudBackupProgress) => onUpload(progress);
      ipcRenderer.on(channel, relay);
      try {
        return await ipcRenderer.invoke(IPC_CHANNELS.cloudSync.backupWork, args);
      } finally {
        ipcRenderer.removeListener(channel, relay);
      }
    },
    listBackups: args => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.listBackups, args),
    downloadBackup: args => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.downloadBackup, args),
    deleteBackup: args => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.deleteBackup, args),
    discardDownload: path => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.discardDownload, path)
  };
}
