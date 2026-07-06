import { describe, expect, it } from 'vitest';

import {
  getModelKey,
  normalizeCustomProviderApi,
  normalizeModelInput,
  normalizeProviderId,
  toOptionalContextWindow,
  validateContextWindow
} from '../pi-model-config.helpers';

describe('pi-model-config helpers', () => {
  it('normalizes known custom provider APIs and rejects unsupported API values', () => {
    expect(normalizeCustomProviderApi('openai-responses')).toBe('openai-responses');
    expect(normalizeCustomProviderApi('google-generative-ai')).toBe('google-generative-ai');
    expect(() => normalizeCustomProviderApi('unknown')).toThrow('不支持的 API 类型：unknown');
  });

  it('keeps text input enabled and removes unsupported or duplicated input types', () => {
    expect(normalizeModelInput(undefined)).toEqual(['text']);
    expect(normalizeModelInput(['image', 'text', 'image', 'audio'])).toEqual(['image', 'text']);
    expect(normalizeModelInput(['image'])).toEqual(['text', 'image']);
  });

  it('accepts portable provider ids and rejects unsafe ids', () => {
    expect(normalizeProviderId(' provider.custom-1 ')).toBe('provider.custom-1');
    expect(() => normalizeProviderId('bad/provider')).toThrow('供应商 ID 只能包含字母、数字、点、下划线和短横线');
    expect(() => normalizeProviderId('')).toThrow('供应商 ID 只能包含字母、数字、点、下划线和短横线');
  });

  it('formats model keys and validates optional context windows', () => {
    expect(getModelKey('openai', 'gpt-4.1')).toBe('openai:gpt-4.1');
    expect(toOptionalContextWindow(128000.9)).toBe(128000);
    expect(toOptionalContextWindow()).toBeUndefined();
    expect(() => validateContextWindow(0)).toThrow('Context Window 必须是大于 0 的数字');
    expect(() => validateContextWindow(Number.NaN)).toThrow('Context Window 必须是大于 0 的数字');
  });
});
