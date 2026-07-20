import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { ipcRenderer } from 'electron';

export function createTasksApi(): ChaptaleDesktopApi['tasks'] {
  return {
    run: payload => ipcRenderer.invoke(IPC_CHANNELS.tasks.run, payload),
    cancel: runId => ipcRenderer.invoke(IPC_CHANNELS.tasks.cancel, { runId }),
    listRuns: payload => ipcRenderer.invoke(IPC_CHANNELS.tasks.listRuns, payload ?? {})
  };
}
