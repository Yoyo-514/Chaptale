import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { ChaptaleDesktopApi, PermissionAskEvent } from '@chaptale/ipc-contract';
import { ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

export function createPermissionsApi(): ChaptaleDesktopApi['permissions'] {
  return {
    getPending: sessionId => ipcRenderer.invoke(IPC_CHANNELS.permissions.pending, sessionId),
    decide: args => ipcRenderer.invoke(IPC_CHANNELS.permissions.decide, args),
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
