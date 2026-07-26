import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { SubagentSlotEventValidator } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

import { onValidatedEvent } from './validated-event';

export function createSubagentApi(): ChaptaleDesktopApi['subagent'] {
  return {
    listActive: sessionId => ipcRenderer.invoke(IPC_CHANNELS.subagent.listActive, sessionId),
    cancel: requestId => ipcRenderer.invoke(IPC_CHANNELS.subagent.cancel, requestId),
    onEvent: listener => onValidatedEvent(IPC_CHANNELS.subagent.event, SubagentSlotEventValidator, listener)
  };
}
