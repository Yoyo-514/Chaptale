import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../../bridge/channels';
import type { CloudListFoldersArgs, CloudProviderArgs } from '../../bridge/cloud-sync';
import type { ChaptaleDesktopApi } from '../../bridge/contracts';

export function createCloudSyncApi(): ChaptaleDesktopApi['cloudSync'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.getState),
    beginAuth: (args: CloudProviderArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.beginAuth, args),
    cancelAuth: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.cancelAuth),
    signOut: (args: CloudProviderArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.signOut, args),
    listFolders: (args: CloudListFoldersArgs) => ipcRenderer.invoke(IPC_CHANNELS.cloudSync.listFolders, args)
  };
}
