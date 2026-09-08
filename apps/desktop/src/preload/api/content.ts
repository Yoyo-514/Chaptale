import { ipcRenderer } from 'electron';

import { IPC_CHANNELS, type ContentApi } from '@chaptale/ipc-contract';

export function createContentApi(): ContentApi {
  return {
    list: args => ipcRenderer.invoke(IPC_CHANNELS.content.list, args),
    read: args => ipcRenderer.invoke(IPC_CHANNELS.content.read, args),
    save: args => ipcRenderer.invoke(IPC_CHANNELS.content.save, args),
    archive: args => ipcRenderer.invoke(IPC_CHANNELS.content.archive, args),
    previewExport: args => ipcRenderer.invoke(IPC_CHANNELS.content.previewExport, args),
    saveExport: args => ipcRenderer.invoke(IPC_CHANNELS.content.saveExport, args),
    previewImport: args => ipcRenderer.invoke(IPC_CHANNELS.content.previewImport, args),
    import: args => ipcRenderer.invoke(IPC_CHANNELS.content.import, args)
  };
}
