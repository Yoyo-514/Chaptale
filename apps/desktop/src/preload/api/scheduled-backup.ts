import { ipcRenderer, type IpcRendererEvent } from 'electron';

import { IPC_CHANNELS } from '../../bridge/channels';
import type { ChaptaleDesktopApi } from '../../bridge/contracts';
import type { ScheduledBackupEvent } from '../../bridge/scheduled-backup';

export function createScheduledBackupApi(): ChaptaleDesktopApi['scheduledBackup'] {
  const channels = IPC_CHANNELS.scheduledBackup;
  return {
    getState: () => ipcRenderer.invoke(channels.getState),
    update: patch => ipcRenderer.invoke(channels.update, patch),
    chooseDirectory: () => ipcRenderer.invoke(channels.chooseDirectory),
    openDirectory: () => ipcRenderer.invoke(channels.openDirectory),
    backupNow: () => ipcRenderer.invoke(channels.backupNow),
    pickBackup: () => ipcRenderer.invoke(channels.pickBackup),
    subscribe(listener) {
      const handler = (_event: IpcRendererEvent, event: ScheduledBackupEvent) => listener(event);
      ipcRenderer.on(channels.event, handler);
      return () => ipcRenderer.removeListener(channels.event, handler);
    }
  };
}
