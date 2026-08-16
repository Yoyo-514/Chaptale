import {
  AddCustomModelArgsValidator,
  AddCustomProviderArgsValidator,
  FetchCustomProviderModelsArgsValidator,
  IPC_CHANNELS,
  RemoveCustomModelArgsValidator,
  RemoveCustomProviderApiKeyArgsValidator,
  SetCustomProviderApiKeyArgsValidator,
  SetDefaultModelArgsValidator,
  UpdateCustomModelInputArgsValidator
} from '@chaptale/ipc-contract';
import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  FetchCustomProviderModelsPayload,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  SetCustomProviderApiKeyPayload,
  SetDefaultModelPayload,
  UpdateCustomModelInputPayload
} from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { ModelService } from './service';

/** 归属模型与认证配置频道；IPC 层负责 sender 信任及参数结构校验，业务与持久化语义交给 ModelService。 */
export function registerModelsIpc(modelService: ModelService) {
  handleTrustedIpc(IPC_CHANNELS.models.list, () => modelService.listModels());

  handleValidatedIpc(
    IPC_CHANNELS.models.setDefault,
    SetDefaultModelArgsValidator,
    (_event, payload: SetDefaultModelPayload) => modelService.setDefaultModel(payload)
  );

  handleValidatedIpc(
    IPC_CHANNELS.models.fetchCustomProviderModels,
    FetchCustomProviderModelsArgsValidator,
    (_event, payload: FetchCustomProviderModelsPayload) => modelService.fetchCustomProviderModels(payload)
  );

  handleValidatedIpc(
    IPC_CHANNELS.models.addCustomProvider,
    AddCustomProviderArgsValidator,
    (_event, payload: AddCustomProviderPayload) => modelService.addCustomProvider(payload)
  );

  handleValidatedIpc(
    IPC_CHANNELS.models.addCustomModel,
    AddCustomModelArgsValidator,
    (_event, payload: AddCustomModelPayload) => modelService.addCustomModel(payload)
  );

  handleValidatedIpc(
    IPC_CHANNELS.models.setCustomProviderApiKey,
    SetCustomProviderApiKeyArgsValidator,
    (_event, payload: SetCustomProviderApiKeyPayload) => modelService.setCustomProviderApiKey(payload)
  );

  handleValidatedIpc(
    IPC_CHANNELS.models.removeCustomProviderApiKey,
    RemoveCustomProviderApiKeyArgsValidator,
    (_event, payload: RemoveCustomProviderApiKeyPayload) => modelService.removeCustomProviderApiKey(payload)
  );

  handleValidatedIpc(
    IPC_CHANNELS.models.updateCustomModelInput,
    UpdateCustomModelInputArgsValidator,
    (_event, payload: UpdateCustomModelInputPayload) => modelService.updateCustomModelInput(payload)
  );

  handleValidatedIpc(
    IPC_CHANNELS.models.removeCustomModel,
    RemoveCustomModelArgsValidator,
    (_event, payload: RemoveCustomModelPayload) => modelService.removeCustomModel(payload)
  );
}
