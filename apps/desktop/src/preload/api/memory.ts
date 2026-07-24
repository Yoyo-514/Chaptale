import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

export function createMemoryApi(): ChaptaleDesktopApi['memory'] {
  return {
    listPending: () => ipcRenderer.invoke(IPC_CHANNELS.memory.listPending),
    resolvePending: args => ipcRenderer.invoke(IPC_CHANNELS.memory.resolvePending, args),
    onPendingChanged: listener => {
      const handler = () => {
        listener();
      };

      ipcRenderer.on(IPC_CHANNELS.memory.pendingChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.memory.pendingChanged, handler);
      };
    }
  };
}
