import { ipcRenderer } from 'electron';

import { IPC_CHANNELS, type TemplatesApi } from '@chaptale/ipc-contract';
export function createTemplatesApi(): TemplatesApi {
  return {
    list: args => ipcRenderer.invoke(IPC_CHANNELS.templates.list, args),
    create: args => ipcRenderer.invoke(IPC_CHANNELS.templates.create, args),
    identify: args => ipcRenderer.invoke(IPC_CHANNELS.templates.identify, args)
  };
}
