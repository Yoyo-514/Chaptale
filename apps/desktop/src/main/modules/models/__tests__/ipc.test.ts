import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';

import { registerModelsIpc } from '../ipc';

type Handler = (_event: unknown, payload?: unknown) => unknown;

const ipcMock = vi.hoisted(() => ({
  trusted: new Map<string, Handler>(),
  validated: new Map<string, Handler>()
}));

vi.mock('../../../infra/security/trusted-ipc', () => ({
  handleTrustedIpc: vi.fn((channel: string, handler: Handler) => {
    ipcMock.trusted.set(channel, handler);
  })
}));

vi.mock('../../../infra/security/validated-ipc', () => ({
  handleValidatedIpc: vi.fn((channel: string, _validator: unknown, handler: Handler) => {
    ipcMock.validated.set(channel, handler);
  })
}));

function getTrustedHandler(channel: string): Handler {
  const handler = ipcMock.trusted.get(channel);

  if (!handler) {
    throw new Error(`未注册 trusted IPC handler：${channel}`);
  }

  return handler;
}

function getValidatedHandler(channel: string): Handler {
  const handler = ipcMock.validated.get(channel);

  if (!handler) {
    throw new Error(`未注册 validated IPC handler：${channel}`);
  }

  return handler;
}

describe('models IPC', () => {
  beforeEach(() => {
    ipcMock.trusted.clear();
    ipcMock.validated.clear();
  });

  it('将模型频道转发给对应服务方法并返回服务结果', async () => {
    const modelService = {
      listModels: vi.fn().mockReturnValue({ models: [] }),
      setDefaultModel: vi.fn().mockResolvedValue({ defaultModelId: 'model-1' }),
      setProviderApiKey: vi.fn().mockResolvedValue({ saved: true }),
      fetchCustomProviderModels: vi.fn().mockResolvedValue([{ id: 'remote-model' }]),
      addCustomProvider: vi.fn().mockResolvedValue({ providerId: 'custom' }),
      addCustomModel: vi.fn().mockResolvedValue({ modelId: 'custom-model' }),
      setCustomProviderApiKey: vi.fn().mockResolvedValue({ providerId: 'custom', saved: true }),
      removeCustomProviderApiKey: vi.fn().mockResolvedValue({ providerId: 'custom', removed: true }),
      updateCustomModelInput: vi.fn().mockResolvedValue({ modelId: 'custom-model', updated: true }),
      removeCustomModel: vi.fn().mockResolvedValue({ modelId: 'custom-model', removed: true }),
      removeProviderAuth: vi.fn().mockResolvedValue({ providerId: 'builtin', removed: true })
    };
    const payload = { providerId: 'custom', modelId: 'custom-model' };

    registerModelsIpc(modelService as never);

    expect(getTrustedHandler(IPC_CHANNELS.models.list)({})).toEqual({ models: [] });
    await expect(getValidatedHandler(IPC_CHANNELS.models.setDefault)({}, payload)).resolves.toEqual({
      defaultModelId: 'model-1'
    });
    await expect(getValidatedHandler(IPC_CHANNELS.models.setProviderApiKey)({}, payload)).resolves.toEqual({
      saved: true
    });
    await expect(getValidatedHandler(IPC_CHANNELS.models.fetchCustomProviderModels)({}, payload)).resolves.toEqual([
      { id: 'remote-model' }
    ]);
    await expect(getValidatedHandler(IPC_CHANNELS.models.addCustomProvider)({}, payload)).resolves.toEqual({
      providerId: 'custom'
    });
    await expect(getValidatedHandler(IPC_CHANNELS.models.addCustomModel)({}, payload)).resolves.toEqual({
      modelId: 'custom-model'
    });
    await expect(getValidatedHandler(IPC_CHANNELS.models.setCustomProviderApiKey)({}, payload)).resolves.toEqual({
      providerId: 'custom',
      saved: true
    });
    await expect(getValidatedHandler(IPC_CHANNELS.models.removeCustomProviderApiKey)({}, payload)).resolves.toEqual({
      providerId: 'custom',
      removed: true
    });
    await expect(getValidatedHandler(IPC_CHANNELS.models.updateCustomModelInput)({}, payload)).resolves.toEqual({
      modelId: 'custom-model',
      updated: true
    });
    await expect(getValidatedHandler(IPC_CHANNELS.models.removeCustomModel)({}, payload)).resolves.toEqual({
      modelId: 'custom-model',
      removed: true
    });
    await expect(getValidatedHandler(IPC_CHANNELS.models.removeProviderAuth)({}, payload)).resolves.toEqual({
      providerId: 'builtin',
      removed: true
    });

    expect(modelService.listModels).toHaveBeenCalledOnce();
    expect(modelService.setDefaultModel).toHaveBeenCalledWith(payload);
    expect(modelService.setProviderApiKey).toHaveBeenCalledWith(payload);
    expect(modelService.fetchCustomProviderModels).toHaveBeenCalledWith(payload);
    expect(modelService.addCustomProvider).toHaveBeenCalledWith(payload);
    expect(modelService.addCustomModel).toHaveBeenCalledWith(payload);
    expect(modelService.setCustomProviderApiKey).toHaveBeenCalledWith(payload);
    expect(modelService.removeCustomProviderApiKey).toHaveBeenCalledWith(payload);
    expect(modelService.updateCustomModelInput).toHaveBeenCalledWith(payload);
    expect(modelService.removeCustomModel).toHaveBeenCalledWith(payload);
    expect(modelService.removeProviderAuth).toHaveBeenCalledWith(payload);
  });
});
