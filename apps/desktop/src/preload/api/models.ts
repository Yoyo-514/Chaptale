import { ipcRenderer } from 'electron';

import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  ChaptaleDesktopApi,
  FetchCustomProviderModelsPayload,
  FetchCustomProviderModelsResult,
  ListModelsResult,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  SetCustomProviderApiKeyPayload,
  SetDefaultModelPayload,
  UpdateCustomModelInputPayload
} from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

/** 为 Renderer 提供模型与认证配置的类型化 IPC 门面，不暴露 ipcRenderer 本身。 */
export function createModelsApi(): ChaptaleDesktopApi['models'] {
  return {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.models.list) as Promise<ListModelsResult>,
    setDefault: (payload: SetDefaultModelPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.models.setDefault, payload) as Promise<ListModelsResult>,
    fetchCustomProviderModels: (payload: FetchCustomProviderModelsPayload) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.models.fetchCustomProviderModels,
        payload
      ) as Promise<FetchCustomProviderModelsResult>,
    addCustomProvider: (payload: AddCustomProviderPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.models.addCustomProvider, payload) as Promise<ListModelsResult>,
    addCustomModel: (payload: AddCustomModelPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.models.addCustomModel, payload) as Promise<ListModelsResult>,
    setCustomProviderApiKey: (payload: SetCustomProviderApiKeyPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.models.setCustomProviderApiKey, payload) as Promise<ListModelsResult>,
    removeCustomProviderApiKey: (payload: RemoveCustomProviderApiKeyPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.models.removeCustomProviderApiKey, payload) as Promise<ListModelsResult>,
    updateCustomModelInput: (payload: UpdateCustomModelInputPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.models.updateCustomModelInput, payload) as Promise<ListModelsResult>,
    removeCustomModel: (payload: RemoveCustomModelPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.models.removeCustomModel, payload) as Promise<ListModelsResult>
  };
}
