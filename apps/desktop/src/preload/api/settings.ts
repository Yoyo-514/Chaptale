import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../../bridge/channels';
import type { ChaptaleDesktopApi } from '../../bridge/contracts';
import type { UpdateChaptaleSettingsPayload } from '../../bridge/settings';

/** 为 Renderer 提供应用设置的类型化 IPC 门面。 */
export function createSettingsApi(): ChaptaleDesktopApi['settings'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.settings.getState),
    update: (payload: UpdateChaptaleSettingsPayload) => ipcRenderer.invoke(IPC_CHANNELS.settings.update, payload),
    openConfigDir: () => ipcRenderer.invoke(IPC_CHANNELS.settings.openConfigDir) as Promise<void>
  };
}
