import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../../bridge/channels';
import type { ChaptaleDesktopApi } from '../../bridge/contracts';

export function createHelpApi(): ChaptaleDesktopApi['help'] {
  const channels = IPC_CHANNELS.help;
  return {
    getAbout: () => ipcRenderer.invoke(channels.getAbout),
    reportIssue: () => ipcRenderer.invoke(channels.reportIssue),
    getUpdateState: () => ipcRenderer.invoke(channels.getUpdateState),
    checkUpdate: () => ipcRenderer.invoke(channels.checkUpdate)
  };
}
