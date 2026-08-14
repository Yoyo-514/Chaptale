import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

import type { ChaptaleCustomProviderApi } from '@chaptale/ipc-contract';

/** 协议接入参数：provider 级配置 + 覆盖用的 model 级字段。 */
export type ProtocolModelSource = {
  providerId: string;
  api: ChaptaleCustomProviderApi;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

/**
 * 四协议 → AI SDK LanguageModel 的唯一映射点。
 *
 * | 协议 | 工厂 | 适用 |
 * |---|---|---|
 * | openai-completions | createOpenAICompatible | DeepSeek/Kimi/Qwen/GLM/OpenRouter/Ollama/vLLM/中转站（容忍非标响应） |
 * | openai-responses   | createOpenAI().responses | OpenAI 官方 Responses API |
 * | anthropic-messages | createAnthropic | Claude 官方及兼容 |
 * | google-generative-ai | createGoogleGenerativeAI | Gemini 官方及兼容 |
 *
 * 严格校验的 createOpenAI 不能打第三方兼容站（zod 严格 schema 会在非标响应上报错），
 * 兼容站一律走 createOpenAICompatible。
 */
export function createProtocolLanguageModel(source: ProtocolModelSource, modelId: string): LanguageModel {
  if (!source.baseUrl) {
    throw new Error(`供应商 ${source.providerId} 缺少 Base URL，无法建立连接`);
  }

  switch (source.api) {
    case 'openai-completions':
      return createOpenAICompatible({
        name: source.providerId,
        baseURL: source.baseUrl,
        apiKey: source.apiKey,
        headers: source.headers
      })(modelId);

    case 'openai-responses':
      return createOpenAI({
        baseURL: source.baseUrl,
        apiKey: source.apiKey,
        headers: source.headers
      }).responses(modelId);

    case 'anthropic-messages':
      return createAnthropic({
        baseURL: source.baseUrl,
        apiKey: source.apiKey,
        headers: source.headers
      })(modelId);

    case 'google-generative-ai':
      return createGoogleGenerativeAI({
        baseURL: source.baseUrl,
        apiKey: source.apiKey,
        headers: source.headers
      })(modelId);

    default:
      throw new Error(`不支持的 API 类型：${source.api}`);
  }
}
