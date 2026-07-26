import { describe, expect, it } from 'vitest';

import type { ChaptaleModelInfo, ChaptaleProviderInfo, FetchedCustomProviderModel } from '@chaptale/ipc-contract';

import {
  countModelsByGroup,
  createProviderViews,
  filterModelsByGroup,
  getDefaultModelLabel,
  getFetchedModelOptions,
  getProviderModels,
  getSelectedProvider
} from '../../utils/llm-settings.helpers';

function createModel(overrides: Partial<ChaptaleModelInfo>): ChaptaleModelInfo {
  return {
    provider: 'openai',
    providerName: 'OpenAI',
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    reasoning: false,
    input: ['text'],
    contextWindow: 128000,
    isCustom: false,
    authConfigured: false,
    isDefault: false,
    ...overrides
  };
}

function createProvider(overrides: Partial<ChaptaleProviderInfo>): ChaptaleProviderInfo {
  return {
    provider: 'openai',
    providerName: 'OpenAI',
    authConfigured: false,
    modelCount: 0,
    ...overrides
  };
}

describe('llm-settings helpers', () => {
  it('filters and counts builtin/custom models', () => {
    const models = [
      createModel({ id: 'builtin-a', isCustom: false }),
      createModel({ id: 'custom-a', isCustom: true }),
      createModel({ id: 'custom-b', isCustom: true })
    ];

    expect(filterModelsByGroup(models, 'builtin').map(model => model.id)).toEqual(['builtin-a']);
    expect(filterModelsByGroup(models, 'custom').map(model => model.id)).toEqual(['custom-a', 'custom-b']);
    expect(countModelsByGroup(models)).toEqual({ builtin: 1, custom: 2 });
  });

  it('creates provider views ordered by auth status then provider name', () => {
    const models = [
      createModel({ provider: 'zeta', providerName: 'Zeta', id: 'zeta-a' }),
      createModel({ provider: 'alpha', providerName: 'Alpha', id: 'alpha-a' }),
      createModel({ provider: 'zeta', providerName: 'Zeta', id: 'zeta-b' }),
      createModel({ provider: 'missing', providerName: 'Missing', id: 'missing-a' })
    ];
    const providers = [
      createProvider({ provider: 'alpha', providerName: 'Alpha Provider', authConfigured: false }),
      createProvider({ provider: 'zeta', providerName: 'Zeta Provider', authConfigured: true })
    ];

    expect(createProviderViews(models, providers)).toEqual([
      expect.objectContaining({ provider: 'zeta', providerName: 'Zeta Provider', authConfigured: true, modelCount: 2 }),
      expect.objectContaining({
        provider: 'alpha',
        providerName: 'Alpha Provider',
        authConfigured: false,
        modelCount: 1
      }),
      expect.objectContaining({ provider: 'missing', providerName: 'missing', authConfigured: false, modelCount: 1 })
    ]);
  });

  it('selects provider and provider models', () => {
    const providers = [createProvider({ provider: 'alpha' }), createProvider({ provider: 'beta' })];
    const models = [createModel({ provider: 'alpha', id: 'a' }), createModel({ provider: 'beta', id: 'b' })];

    expect(getSelectedProvider(providers, 'beta')?.provider).toBe('beta');
    expect(getSelectedProvider(providers, 'unknown')?.provider).toBe('alpha');
    expect(getProviderModels(models, providers[1]).map(model => model.id)).toEqual(['b']);
    expect(getProviderModels(models, undefined)).toEqual([]);
  });

  it('marks fetched models that already exist in selected provider', () => {
    const fetchedModels: FetchedCustomProviderModel[] = [{ id: 'exists' }, { id: 'new-model' }];
    const selectedProviderModels = [createModel({ id: 'exists' })];

    expect(getFetchedModelOptions(fetchedModels, selectedProviderModels)).toEqual([
      { id: 'exists', isAdded: true },
      { id: 'new-model', isAdded: false }
    ]);
  });

  it('formats default model label with fallback', () => {
    const models = [createModel({ provider: 'openai', providerName: 'OpenAI', id: 'gpt-4o', name: 'GPT-4o' })];

    expect(getDefaultModelLabel()).toBe('未选择');
    expect(
      getDefaultModelLabel({ models, providers: [], defaultModel: { provider: 'openai', modelId: 'gpt-4o' } })
    ).toBe('OpenAI / GPT-4o');
    expect(getDefaultModelLabel({ models, providers: [], defaultModel: { provider: 'dot', modelId: 'gemini' } })).toBe(
      'dot/gemini'
    );
  });
});
