import type {
  ChaptaleModelInfo,
  ChaptaleProviderInfo,
  FetchedCustomProviderModel,
  ListModelsResult
} from '@chaptale/ipc-contract';

export type ModelGroup = 'builtin' | 'custom';

export type ProviderView = ChaptaleProviderInfo;

export function filterModelsByGroup(models: ChaptaleModelInfo[], group: ModelGroup) {
  return models.filter(model => model.isCustom === (group === 'custom'));
}

export function createProviderViews(models: ChaptaleModelInfo[], providers: ChaptaleProviderInfo[]): ProviderView[] {
  const providerMap = new Map(providers.map(provider => [provider.provider, provider]));
  const countMap = new Map<string, number>();

  for (const model of models) {
    countMap.set(model.provider, (countMap.get(model.provider) ?? 0) + 1);
  }

  return [...countMap.entries()]
    .map(([provider, modelCount]) => {
      const baseProvider = providerMap.get(provider);
      return {
        provider,
        providerName: baseProvider?.providerName ?? provider,
        authConfigured: Boolean(baseProvider?.authConfigured),
        authSource: baseProvider?.authSource,
        modelCount
      } satisfies ProviderView;
    })
    .toSorted((left, right) => {
      if (left.authConfigured !== right.authConfigured) {
        return left.authConfigured ? -1 : 1;
      }

      return left.providerName.localeCompare(right.providerName);
    });
}

export function getSelectedProvider(providerViews: ProviderView[], selectedProviderId: string) {
  return providerViews.find(provider => provider.provider === selectedProviderId) ?? providerViews[0];
}

export function getProviderModels(models: ChaptaleModelInfo[], provider?: ProviderView) {
  return provider ? models.filter(model => model.provider === provider.provider) : [];
}

export function getAddableFetchedModels(
  fetchedModels: FetchedCustomProviderModel[],
  selectedProviderModels: ChaptaleModelInfo[]
) {
  const existingIds = new Set(selectedProviderModels.map(model => model.id));
  return fetchedModels.filter(model => !existingIds.has(model.id));
}

export function countModelsByGroup(models: ChaptaleModelInfo[]) {
  return {
    builtin: models.filter(model => !model.isCustom).length,
    custom: models.filter(model => model.isCustom).length
  };
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
