import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { ipcMain } from 'electron';
import { PiModelService } from '../services/pi-model.service';

import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  FetchCustomProviderModelsPayload,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  RemoveProviderAuthPayload,
  SetCustomProviderApiKeyPayload,
  SetDefaultModelPayload,
  SetProviderApiKeyPayload,
  UpdateCustomModelInputPayload
} from '@chaptale/ipc-contract';

export function registerModelsIpc(modelService: PiModelService) {
  ipcMain.handle(IPC_CHANNELS.models.list, () => modelService.listModels());

  ipcMain.handle(IPC_CHANNELS.models.setDefault, (_event, payload: SetDefaultModelPayload) =>
    modelService.setDefaultModel(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.setProviderApiKey, (_event, payload: SetProviderApiKeyPayload) =>
    modelService.setProviderApiKey(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.fetchCustomProviderModels, (_event, payload: FetchCustomProviderModelsPayload) =>
    modelService.fetchCustomProviderModels(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.addCustomProvider, (_event, payload: AddCustomProviderPayload) =>
    modelService.addCustomProvider(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.addCustomModel, (_event, payload: AddCustomModelPayload) =>
    modelService.addCustomModel(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.setCustomProviderApiKey, (_event, payload: SetCustomProviderApiKeyPayload) =>
    modelService.setCustomProviderApiKey(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.removeCustomProviderApiKey, (_event, payload: RemoveCustomProviderApiKeyPayload) =>
    modelService.removeCustomProviderApiKey(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.updateCustomModelInput, (_event, payload: UpdateCustomModelInputPayload) =>
    modelService.updateCustomModelInput(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.removeCustomModel, (_event, payload: RemoveCustomModelPayload) =>
    modelService.removeCustomModel(payload)
  );

  ipcMain.handle(IPC_CHANNELS.models.removeProviderAuth, (_event, payload: RemoveProviderAuthPayload) =>
    modelService.removeProviderAuth(payload)
  );
}
