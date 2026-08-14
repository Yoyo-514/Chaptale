import { alphabetical, counting } from 'radash';

import type {
  ChaptaleModelInfo,
  ChaptaleProviderInfo,
  FetchedCustomProviderModel,
  ListModelsResult
} from '@chaptale/ipc-contract';

export type ProviderView = ChaptaleProviderInfo;

/**
 * 以当前分组可见模型重新计算供应商计数，同时复用后端返回的认证来源与展示名称。
 * 已认证供应商排在前面，组内按名称排序，减少列表跳动。
 */
export function createProviderViews(models: ChaptaleModelInfo[], providers: ChaptaleProviderInfo[]): ProviderView[] {
  const providerMap = new Map(providers.map(provider => [provider.provider, provider]));
  const modelCountsByProvider = counting(models, model => model.provider);
  const providerViews = Object.entries(modelCountsByProvider).map(([provider, modelCount]) => {
    const baseProvider = providerMap.get(provider);
    return {
      provider,
      providerName: baseProvider?.providerName ?? provider,
      authConfigured: Boolean(baseProvider?.authConfigured),
      authSource: baseProvider?.authSource,
      modelCount
    } satisfies ProviderView;
  });

  return [
    ...alphabetical(
      providerViews.filter(provider => provider.authConfigured),
      provider => provider.providerName
    ),
    ...alphabetical(
      providerViews.filter(provider => !provider.authConfigured),
      provider => provider.providerName
    )
  ];
}

export function getSelectedProvider(providerViews: ProviderView[], selectedProviderId: string) {
  return providerViews.find(provider => provider.provider === selectedProviderId) ?? providerViews[0];
}

export function getProviderModels(models: ChaptaleModelInfo[], provider?: ProviderView) {
  return provider ? models.filter(model => model.provider === provider.provider) : [];
}

export type FetchedCustomProviderModelView = FetchedCustomProviderModel & {
  isAdded: boolean;
};

export function getFetchedModelOptions(
  fetchedModels: FetchedCustomProviderModel[],
  selectedProviderModels: ChaptaleModelInfo[]
): FetchedCustomProviderModelView[] {
  const existingIds = new Set(selectedProviderModels.map(model => model.id));
  return fetchedModels.map(model => ({ ...model, isAdded: existingIds.has(model.id) }));
}

export function getDefaultModelLabel(modelState?: ListModelsResult) {
  const defaultModel = modelState?.defaultModel;

  if (!defaultModel) {
    return '未选择';
  }

  const model = modelState.models.find(
    item => item.provider === defaultModel.provider && item.id === defaultModel.modelId
  );
  return model ? `${model.providerName} / ${model.name}` : `${defaultModel.provider}/${defaultModel.modelId}`;
}
