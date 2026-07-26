import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  ChaptaleModelInput,
  FetchCustomProviderModelsPayload,
  ListModelsResult
} from '@chaptale/ipc-contract';

import { getDesktopApi } from '@/utils/desktop-api';

import type { SettingsStoreContext } from './types';

export const modelSettingsActions = {
  async loadModels(this: SettingsStoreContext) {
    this.isModelsLoading = true;

    try {
      const models = await this.runAction('读取模型清单失败', () => getDesktopApi().models.list());
      if (models) {
        this.models = models;
      }
    } finally {
      this.isModelsLoading = false;
    }
  },

  /** 模型相关动作的公共模式：调用后端并整体替换模型清单。 */
  async runModelsAction(this: SettingsStoreContext, title: string, action: () => Promise<ListModelsResult>) {
    const models = await this.runAction(title, action);

    if (models) {
      this.models = models;
    }

    return models !== undefined;
  },

  setDefaultModel(this: SettingsStoreContext, provider: string, modelId: string) {
    return this.runModelsAction('设置默认模型失败', () => getDesktopApi().models.setDefault({ provider, modelId }));
  },

  setProviderApiKey(this: SettingsStoreContext, provider: string, apiKey: string) {
    return this.runModelsAction('保存 API Key 失败', () =>
      getDesktopApi().models.setProviderApiKey({ provider, apiKey })
    );
  },

  async fetchCustomProviderModels(this: SettingsStoreContext, payload: FetchCustomProviderModelsPayload) {
    this.isFetchingCustomModels = true;

    try {
      const result = await this.runAction('拉取模型列表失败', () =>
        getDesktopApi().models.fetchCustomProviderModels(payload)
      );
      this.fetchedCustomModels = result?.models ?? [];
      return result !== undefined;
    } finally {
      this.isFetchingCustomModels = false;
    }
  },

  clearFetchedCustomModels(this: SettingsStoreContext) {
    this.fetchedCustomModels = [];
  },

  async addCustomProvider(this: SettingsStoreContext, payload: AddCustomProviderPayload) {
    this.isModelsLoading = true;

    try {
      return await this.runModelsAction('添加供应商失败', () => getDesktopApi().models.addCustomProvider(payload));
    } finally {
      this.isModelsLoading = false;
    }
  },

  addCustomModel(this: SettingsStoreContext, payload: AddCustomModelPayload) {
    return this.runModelsAction('添加模型失败', () => getDesktopApi().models.addCustomModel(payload));
  },

  setCustomProviderApiKey(this: SettingsStoreContext, provider: string, apiKey: string) {
    return this.runModelsAction('保存 API Key 失败', () =>
      getDesktopApi().models.setCustomProviderApiKey({ provider, apiKey })
    );
  },

  removeCustomProviderApiKey(this: SettingsStoreContext, provider: string) {
    return this.runModelsAction('移除 API Key 失败', () =>
      getDesktopApi().models.removeCustomProviderApiKey({ provider })
    );
  },

  updateCustomModelInput(this: SettingsStoreContext, provider: string, modelId: string, input: ChaptaleModelInput[]) {
    return this.runModelsAction('更新模型能力失败', () =>
      getDesktopApi().models.updateCustomModelInput({ provider, modelId, input })
    );
  },

  async removeCustomModel(this: SettingsStoreContext, provider: string, modelId: string) {
    this.isModelsLoading = true;

    try {
      return await this.runModelsAction('删除自定义模型失败', () =>
        getDesktopApi().models.removeCustomModel({ provider, modelId })
      );
    } finally {
      this.isModelsLoading = false;
    }
  },

  removeProviderApiKey(this: SettingsStoreContext, provider: string) {
    return this.runModelsAction('移除 API Key 失败', () => getDesktopApi().models.removeProviderAuth({ provider }));
  }
};
