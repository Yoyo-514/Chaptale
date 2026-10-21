import { ipcRenderer } from 'electron';

import type { UpdateChaptaleSettingsPayload } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

import type { ChaptaleDesktopApi } from '../../bridge/contracts';

/** 为 Renderer 提供应用设置的类型化 IPC 门面。 */
export function createSettingsApi(): ChaptaleDesktopApi['settings'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.settings.getState),
    update: (payload: UpdateChaptaleSettingsPayload) => ipcRenderer.invoke(IPC_CHANNELS.settings.update, payload),
    selectWorkspaceDir: () => ipcRenderer.invoke(IPC_CHANNELS.settings.selectWorkspaceDir),
    openConfigDir: () => ipcRenderer.invoke(IPC_CHANNELS.settings.openConfigDir) as Promise<void>
  };
}
