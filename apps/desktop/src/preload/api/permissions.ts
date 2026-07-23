import type { IpcRendererEvent } from 'electron';
import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi, PermissionAskEvent } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract';

export function createPermissionsApi(): ChaptaleDesktopApi['permissions'] {
  return {
    getPending: sessionId => ipcRenderer.invoke(IPC_CHANNELS.permissions.pending, sessionId),
    decide: args => ipcRenderer.invoke(IPC_CHANNELS.permissions.decide, args),
    listRules: () => ipcRenderer.invoke(IPC_CHANNELS.permissions.listRules),
    removeRule: args => ipcRenderer.invoke(IPC_CHANNELS.permissions.removeRule, args),
    onAsk: listener => {
      const handler = (_event: IpcRendererEvent, payload: PermissionAskEvent) => {
        listener(payload);
      };

      ipcRenderer.on(IPC_CHANNELS.permissions.ask, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.permissions.ask, handler);
      };
    }
  };
}
