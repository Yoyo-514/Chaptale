import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

export function createTasksApi(): ChaptaleDesktopApi['tasks'] {
  return {
    run: payload => ipcRenderer.invoke(IPC_CHANNELS.tasks.run, payload),
    cancel: requestId => ipcRenderer.invoke(IPC_CHANNELS.tasks.cancel, { requestId }),
    listRuns: payload => ipcRenderer.invoke(IPC_CHANNELS.tasks.listRuns, payload ?? {}),
    readRunOutput: outputRef => ipcRenderer.invoke(IPC_CHANNELS.tasks.readRunOutput, outputRef)
  };
}
