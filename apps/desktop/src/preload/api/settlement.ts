import { ipcRenderer } from 'electron';

import { IPC_CHANNELS, type SettlementApi } from '@chaptale/ipc-contract';

export function createSettlementApi(): SettlementApi {
  return {
    list: args => ipcRenderer.invoke(IPC_CHANNELS.settlement.list, args),
    unsettled: args => ipcRenderer.invoke(IPC_CHANNELS.settlement.unsettled, args),
    prepare: args => ipcRenderer.invoke(IPC_CHANNELS.settlement.prepare, args),
    start: args => ipcRenderer.invoke(IPC_CHANNELS.settlement.start, args),
    read: args => ipcRenderer.invoke(IPC_CHANNELS.settlement.read, args),
    cancel: args => ipcRenderer.invoke(IPC_CHANNELS.settlement.cancel, args),
    resolve: args => ipcRenderer.invoke(IPC_CHANNELS.settlement.resolve, args),
    complete: args => ipcRenderer.invoke(IPC_CHANNELS.settlement.complete, args)
  };
}
