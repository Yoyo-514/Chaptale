import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  ChaptaleModelInput,
  FetchCustomProviderModelsPayload,
  FetchedCustomProviderModel,
  ChaptaleSettingsState,
  ListModelsResult,
  UpdateChaptaleSettingsPayload
} from '@chaptale/ipc-contract';
import { defineStore } from 'pinia';

import { useToastStore } from './toast';

export type SettingsSection = 'workspace' | 'llm' | 'files';

function getDesktopApi() {
  if (!window.chaptaleDesktop) {
    throw new Error('当前界面需要在 Chaptale 桌面端中运行');
  }

  return window.chaptaleDesktop;
}

function toErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // Electron IPC 错误带有 "Error invoking remote method 'xxx':" 前缀，去掉后更可读
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    state: undefined as ChaptaleSettingsState | undefined,
    models: undefined as ListModelsResult | undefined,
    activeSection: 'workspace' as SettingsSection,
    isOpen: false,
    isLoading: false,
    isModelsLoading: false,
    isFetchingCustomModels: false,
    fetchedCustomModels: [] as FetchedCustomProviderModel[],
    error: ''
  }),
  actions: {
    /**
     * 统一的动作执行辅助：清空错误、捕获异常并发 toast。
     * 返回 undefined 表示失败（错误已提示给用户）。
     */
    async runAction<T>(title: string, action: () => Promise<T>): Promise<T | undefined> {
      this.error = '';

      try {
        return await action();
      } catch (error) {
        this.error = toErrorMessage(error);
        useToastStore().error(title, this.error);
        return undefined;
      }
    },

    openPanel(section?: SettingsSection) {
      this.isOpen = true;

      if (section) {
        this.activeSection = section;
      }

      void this.load();
      void this.loadModels();
    },

    closePanel() {
      this.isOpen = false;
    },

    setSection(section: SettingsSection) {
      this.activeSection = section;

      if (section === 'llm' && !this.models) {
        void this.loadModels();
      }
    },

    async load() {
      this.isLoading = true;

      try {
        const state = await this.runAction('读取设置失败', () => getDesktopApi().settings.getState());
        if (state) {
          this.state = state;
        }
      } finally {
        this.isLoading = false;
      }
    },

    async update(payload: UpdateChaptaleSettingsPayload) {
      this.isLoading = true;

      try {
        const state = await this.runAction('更新设置失败', () => getDesktopApi().settings.update(payload));
        if (state) {
          this.state = state;
        }
      } finally {
        this.isLoading = false;
      }
    },

    async selectWorkspaceDir() {
      this.isLoading = true;

      try {
        const result = await this.runAction('选择工作区失败', () => getDesktopApi().settings.selectWorkspaceDir());
        if (result && !result.canceled && result.state) {
          this.state = result.state;
        }
      } finally {
        this.isLoading = false;
      }
    },

    async useGlobalStorage() {
      await this.update({ storage: { mode: 'global' } });
    },

    async openConfigDir() {
      await this.runAction('打开配置目录失败', () => getDesktopApi().settings.openConfigDir());
    },

    async loadModels() {
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
    async runModelsAction(title: string, action: () => Promise<ListModelsResult>) {
      const models = await this.runAction(title, action);

      if (models) {
        this.models = models;
      }

      return models !== undefined;
    },

    setDefaultModel(provider: string, modelId: string) {
      return this.runModelsAction('设置默认模型失败', () => getDesktopApi().models.setDefault({ provider, modelId }));
    },

    setProviderApiKey(provider: string, apiKey: string) {
      return this.runModelsAction('保存凭据失败', () => getDesktopApi().models.setProviderApiKey({ provider, apiKey }));
    },

    async fetchCustomProviderModels(payload: FetchCustomProviderModelsPayload) {
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

    clearFetchedCustomModels() {
      this.fetchedCustomModels = [];
    },

    async addCustomProvider(payload: AddCustomProviderPayload) {
      this.isModelsLoading = true;

      try {
        return await this.runModelsAction('添加供应商失败', () => getDesktopApi().models.addCustomProvider(payload));
      } finally {
        this.isModelsLoading = false;
      }
    },

    addCustomModel(payload: AddCustomModelPayload) {
      return this.runModelsAction('添加模型失败', () => getDesktopApi().models.addCustomModel(payload));
    },

    setCustomProviderApiKey(provider: string, apiKey: string) {
      return this.runModelsAction('保存模型 Key 失败', () =>
        getDesktopApi().models.setCustomProviderApiKey({ provider, apiKey })
      );
    },

    removeCustomProviderApiKey(provider: string) {
      return this.runModelsAction('移除模型 Key 失败', () =>
        getDesktopApi().models.removeCustomProviderApiKey({ provider })
      );
    },

    updateCustomModelInput(provider: string, modelId: string, input: ChaptaleModelInput[]) {
      return this.runModelsAction('更新模型能力失败', () =>
        getDesktopApi().models.updateCustomModelInput({ provider, modelId, input })
      );
    },

    async removeCustomModel(provider: string, modelId: string) {
      this.isModelsLoading = true;

      try {
        return await this.runModelsAction('删除自定义模型失败', () =>
          getDesktopApi().models.removeCustomModel({ provider, modelId })
        );
      } finally {
        this.isModelsLoading = false;
      }
    },

    removeProviderAuth(provider: string) {
      return this.runModelsAction('移除凭据失败', () => getDesktopApi().models.removeProviderAuth({ provider }));
    }
  }
});
