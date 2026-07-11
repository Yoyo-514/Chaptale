import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { handleTrustedIpc } from '../security/trusted-ipc';
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
  handleTrustedIpc(IPC_CHANNELS.models.list, () => modelService.listModels());

  handleTrustedIpc(IPC_CHANNELS.models.setDefault, (_event, payload: SetDefaultModelPayload) =>
    modelService.setDefaultModel(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.models.setProviderApiKey, (_event, payload: SetProviderApiKeyPayload) =>
    modelService.setProviderApiKey(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.models.fetchCustomProviderModels, (_event, payload: FetchCustomProviderModelsPayload) =>
    modelService.fetchCustomProviderModels(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.models.addCustomProvider, (_event, payload: AddCustomProviderPayload) =>
    modelService.addCustomProvider(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.models.addCustomModel, (_event, payload: AddCustomModelPayload) =>
    modelService.addCustomModel(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.models.setCustomProviderApiKey, (_event, payload: SetCustomProviderApiKeyPayload) =>
    modelService.setCustomProviderApiKey(payload)
  );

  handleTrustedIpc(
    IPC_CHANNELS.models.removeCustomProviderApiKey,
    (_event, payload: RemoveCustomProviderApiKeyPayload) => modelService.removeCustomProviderApiKey(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.models.updateCustomModelInput, (_event, payload: UpdateCustomModelInputPayload) =>
    modelService.updateCustomModelInput(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.models.removeCustomModel, (_event, payload: RemoveCustomModelPayload) =>
    modelService.removeCustomModel(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.models.removeProviderAuth, (_event, payload: RemoveProviderAuthPayload) =>
    modelService.removeProviderAuth(payload)
  );
}
