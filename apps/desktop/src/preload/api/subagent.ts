import type { IpcRendererEvent } from 'electron';
import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';
import type { SubagentSlotEvent } from '@chaptale/shared';

export function createSubagentApi(): ChaptaleDesktopApi['subagent'] {
  return {
    listActive: sessionId => ipcRenderer.invoke(IPC_CHANNELS.subagent.listActive, sessionId),
    cancel: requestId => ipcRenderer.invoke(IPC_CHANNELS.subagent.cancel, requestId),
    onEvent: listener => {
      const handler = (_event: IpcRendererEvent, payload: SubagentSlotEvent) => {
        listener(payload);
      };

      ipcRenderer.on(IPC_CHANNELS.subagent.event, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.subagent.event, handler);
      };
    }
  };
}
