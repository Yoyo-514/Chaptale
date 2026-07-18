import { afterEach, describe, expect, it, vi } from 'vitest';

import { createModelsUrl, fetchProviderModels, parseFetchedModels } from '../provider-model-fetcher';

describe('provider-model-fetcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds provider model URLs without duplicate slashes and adds Gemini key query', () => {
    expect(createModelsUrl('https://api.example.com///', 'openai-responses').toString()).toBe(
      'https://api.example.com/models'
    );
    expect(
      createModelsUrl('https://generativelanguage.googleapis.com/v1beta/', 'google-generative-ai', 'key').toString()
    ).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=key');
  });

  it('parses common model list shapes and normalizes Gemini model ids', () => {
    expect(
      parseFetchedModels(
        {
          data: [{ id: 'gpt-4.1', name: 'GPT 4.1' }, { id: '', name: '' }, null]
        },
        'openai-responses'
      )
    ).toEqual([{ id: 'gpt-4.1', name: 'GPT 4.1' }]);

    expect(
      parseFetchedModels(
        {
          models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }]
        },
        'google-generative-ai'
      )
    ).toEqual([{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }]);
  });

  it('fetches model lists with the expected auth header for OpenAI-compatible APIs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'model-a' }] })
    } as Response);

    await expect(
      fetchProviderModels({ baseUrl: 'https://api.example.com', api: 'openai-responses', apiKey: ' token ' })
    ).resolves.toEqual({ models: [{ id: 'model-a', name: 'model-a' }] });

    expect(fetchMock).toHaveBeenCalledWith(new URL('https://api.example.com/models'), {
      headers: { Accept: 'application/json', Authorization: 'Bearer token' }
    });
  });

  it('surfaces user-actionable errors for missing keys, unsupported APIs, and failed requests', async () => {
    await expect(
      fetchProviderModels({ baseUrl: 'https://api.example.com', api: 'openai-responses', apiKey: '   ' })
    ).rejects.toThrow('请先填写模型 Key');

    await expect(
      fetchProviderModels({ baseUrl: 'https://api.example.com', api: 'anthropic-messages', apiKey: 'key' })
    ).rejects.toThrow('当前 API 类型没有通用模型列表接口');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 502 } as Response);
    await expect(
      fetchProviderModels({ baseUrl: 'https://api.example.com', api: 'openai-responses', apiKey: 'key' })
    ).rejects.toThrow('模型列表请求失败：HTTP 502');
  });
});
