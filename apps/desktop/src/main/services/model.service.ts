import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

const supportedProviders = ['openai-chat', 'openai-responses', 'anthropic-messages'] as const;
type ModelProvider = (typeof supportedProviders)[number];

export class ModelService {
  readonly modelName: string;
  readonly modelProvider: ModelProvider;
  readonly model: LanguageModel;

  constructor() {
    const apiKey = process.env.API_KEY;
    const modelName = process.env.MODEL;
    const modelProvider = process.env.MODEL_PROVIDER ?? 'openai-chat';

    if (!apiKey || !modelName) {
      throw new Error('请在 .env 中设置 API_KEY 和 MODEL 值');
    }

    const provider = this.parseProvider(modelProvider);

    if (provider === 'openai-chat' && !process.env.BASE_URL) {
      throw new Error('使用 OpenAI Chat Completions 协议时，请在 .env 中设置 BASE_URL 值');
    }

    this.modelName = modelName;
    this.modelProvider = provider;
    this.model = this.createModel(apiKey, modelName, provider);
  }

  private parseProvider(provider: string): ModelProvider {
    if (supportedProviders.includes(provider as ModelProvider)) {
      return provider as ModelProvider;
    }

    throw new Error(`不支持的 MODEL_PROVIDER：${provider}，可选值：${supportedProviders.join(', ')}`);
  }

  private createModel(apiKey: string, modelName: string, provider: ModelProvider) {
    if (provider === 'anthropic-messages') {
      const anthropic = this.createAnthropicProvider(apiKey);

      /**
       * Anthropic Messages 协议。
       *
       * BASE_URL 可用于指定 A 社官方地址之外的第三方 Messages 协议服务。
       */
      return anthropic(modelName);
    }

    const openai = this.createOpenAIProvider(apiKey);

    if (provider === 'openai-responses') {
      /**
       * OpenAI Responses API。
       */
      return openai(modelName);
    }

    /**
     * OpenAI Chat Completions 协议。
     */
    return openai.chat(modelName);
  }

  private createOpenAIProvider(apiKey: string) {
    return createOpenAI({
      apiKey,
      baseURL: process.env.BASE_URL,
      headers: this.commonHeaders()
    });
  }

  private createAnthropicProvider(apiKey: string) {
    return createAnthropic({
      apiKey,
      baseURL: process.env.BASE_URL,
      headers: this.commonHeaders()
    });
  }

  private commonHeaders() {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    };
  }
}
