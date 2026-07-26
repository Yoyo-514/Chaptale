import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { MemoryPendingChangedEventValidator } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

import { onValidatedEvent } from './validated-event';

export function createMemoryApi(): ChaptaleDesktopApi['memory'] {
  return {
    listPending: () => ipcRenderer.invoke(IPC_CHANNELS.memory.listPending),
    resolvePending: args => ipcRenderer.invoke(IPC_CHANNELS.memory.resolvePending, args),
    // pendingChanged 无 payload：校验只确认没有伪装数据，通过后调用无参 listener。
    onPendingChanged: listener =>
      onValidatedEvent(IPC_CHANNELS.memory.pendingChanged, MemoryPendingChangedEventValidator, () => {
        listener();
      })
  };
}
