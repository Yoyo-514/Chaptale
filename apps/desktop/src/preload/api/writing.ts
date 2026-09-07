import { ipcRenderer } from 'electron';

import { IPC_CHANNELS, type WritingApi } from '@chaptale/ipc-contract';

export function createWritingApi(): WritingApi {
  return {
    generate: args => ipcRenderer.invoke(IPC_CHANNELS.writing.generate, args),
    prepareRewrite: args => ipcRenderer.invoke(IPC_CHANNELS.writing.prepareRewrite, args),
    rewrite: args => ipcRenderer.invoke(IPC_CHANNELS.writing.rewrite, args),
    cancel: args => ipcRenderer.invoke(IPC_CHANNELS.writing.cancel, args),
    listCandidates: args => ipcRenderer.invoke(IPC_CHANNELS.writing.listCandidates, args),
    readCandidate: args => ipcRenderer.invoke(IPC_CHANNELS.writing.readCandidate, args),
    discard: args => ipcRenderer.invoke(IPC_CHANNELS.writing.discard, args),
    apply: args => ipcRenderer.invoke(IPC_CHANNELS.writing.apply, args),
    listVersions: args => ipcRenderer.invoke(IPC_CHANNELS.writing.listVersions, args),
    readVersion: args => ipcRenderer.invoke(IPC_CHANNELS.writing.readVersion, args)
  };
}
