import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

export function createTasksApi(): ChaptaleDesktopApi['tasks'] {
  return {
    run: payload => ipcRenderer.invoke(IPC_CHANNELS.tasks.run, payload),
    cancel: requestId => ipcRenderer.invoke(IPC_CHANNELS.tasks.cancel, { requestId }),
    listRuns: payload => ipcRenderer.invoke(IPC_CHANNELS.tasks.listRuns, payload ?? {})
  };
}
