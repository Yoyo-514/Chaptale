import { ipcRenderer } from 'electron';

import { IPC_CHANNELS, type LibraryApi } from '@chaptale/ipc-contract';

export function createLibraryApi(): LibraryApi {
  return {
    sceneReferences: args => ipcRenderer.invoke(IPC_CHANNELS.library.sceneReferences, args),
    listAssets: args => ipcRenderer.invoke(IPC_CHANNELS.library.listAssets, args),
    resolveLink: args => ipcRenderer.invoke(IPC_CHANNELS.library.resolveLink, args),
    composePack: args => ipcRenderer.invoke(IPC_CHANNELS.library.composePack, args),
    freezePack: args => ipcRenderer.invoke(IPC_CHANNELS.library.freezePack, args),
    readPack: args => ipcRenderer.invoke(IPC_CHANNELS.library.readPack, args),
    checkPack: args => ipcRenderer.invoke(IPC_CHANNELS.library.checkPack, args)
  };
}
