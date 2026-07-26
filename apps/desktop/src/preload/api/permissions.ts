import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { PermissionAskEventValidator } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

import { onValidatedEvent } from './validated-event';

export function createPermissionsApi(): ChaptaleDesktopApi['permissions'] {
  return {
    getPending: sessionId => ipcRenderer.invoke(IPC_CHANNELS.permissions.pending, sessionId),
    decide: args => ipcRenderer.invoke(IPC_CHANNELS.permissions.decide, args),
    listRules: () => ipcRenderer.invoke(IPC_CHANNELS.permissions.listRules),
    removeRule: args => ipcRenderer.invoke(IPC_CHANNELS.permissions.removeRule, args),
    onAsk: listener => onValidatedEvent(IPC_CHANNELS.permissions.ask, PermissionAskEventValidator, listener)
  };
}
