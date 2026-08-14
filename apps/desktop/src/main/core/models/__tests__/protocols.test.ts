import { describe, expect, it, vi } from 'vitest';

const { createOpenAICompatible, createOpenAIMock, createAnthropicMock, createGoogleMock } = vi.hoisted(() => ({
  createOpenAICompatible: vi.fn(() => {
    throw new Error('stub');
  }),
  createOpenAIMock: vi.fn(() => ({ responses: (id: string) => `openai-responses:${id}` })),
  createAnthropicMock: vi.fn(() => (id: string) => `anthropic:${id}`),
  createGoogleMock: vi.fn(() => (id: string) => `google:${id}`)
}));

vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: createOpenAIMock }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: createAnthropicMock }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: createGoogleMock }));

import { createProtocolLanguageModel } from '../protocols';

const baseSource = {
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  headers: { 'X-Custom': '1' }
} as const;

describe('createProtocolLanguageModel', () => {
  it('openai-completions → createOpenAICompatible 且透传 baseURL/key/headers', () => {
    createOpenAICompatible.mockImplementation((() => (id: string) => `compatible:${id}`) as never);

    const model = createProtocolLanguageModel({ ...baseSource, api: 'openai-completions' }, 'deepseek-chat');

    expect(model).toBe('compatible:deepseek-chat');
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      headers: { 'X-Custom': '1' }
    });
  });

  it('openai-responses → createOpenAI().responses(modelId)', () => {
    const model = createProtocolLanguageModel({ ...baseSource, api: 'openai-responses' }, 'gpt-5');

    expect(model).toBe('openai-responses:gpt-5');
  });

  it('anthropic-messages → createAnthropic()(modelId)', () => {
    const model = createProtocolLanguageModel({ ...baseSource, api: 'anthropic-messages' }, 'claude-x');

    expect(model).toBe('anthropic:claude-x');
  });

  it('google-generative-ai → createGoogleGenerativeAI()(modelId)', () => {
    const model = createProtocolLanguageModel({ ...baseSource, api: 'google-generative-ai' }, 'gemini-x');

    expect(model).toBe('google:gemini-x');
  });

  it('缺 Base URL → 尽早抛配置错误', () => {
    expect(() =>
      createProtocolLanguageModel({ ...baseSource, api: 'openai-completions', baseUrl: undefined }, 'm')
    ).toThrow('缺少 Base URL');
  });
});
