import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL;
const MODEL = process.env.MODEL;
const MODEL_PROVIDER = process.env.MODEL_PROVIDER ?? 'openai-chat';

const supportedProviders = ['openai-chat', 'openai-responses', 'anthropic-messages'] as const;
type ModelProvider = (typeof supportedProviders)[number];

if (!API_KEY || !MODEL) {
  throw new Error('请在 .env 中设置 API_KEY 和 MODEL 值');
}

function parseProvider(provider: string): ModelProvider {
  if (supportedProviders.includes(provider as ModelProvider)) {
    return provider as ModelProvider;
  }

  throw new Error(`不支持的 MODEL_PROVIDER：${provider}，可选值：${supportedProviders.join(', ')}`);
}

const provider = parseProvider(MODEL_PROVIDER);

if (provider === 'openai-chat' && !BASE_URL) {
  throw new Error('使用 OpenAI Chat Completions 协议时，请在 .env 中设置 BASE_URL 值');
}

export const modelName = MODEL;
export const modelProvider = provider;

const commonHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache'
};

function createOpenAIProvider() {
  return createOpenAI({
    apiKey: API_KEY,
    baseURL: BASE_URL,
    headers: commonHeaders
  });
}

function createAnthropicProvider() {
  return createAnthropic({
    apiKey: API_KEY,
    baseURL: BASE_URL,
    headers: commonHeaders
  });
}

function createModel() {
  if (provider === 'anthropic-messages') {
    const anthropic = createAnthropicProvider();

    /**
     * Anthropic Messages 协议。
     *
     * BASE_URL 可用于指定 A 社官方地址之外的第三方 Messages 协议服务。
     */
    return anthropic(MODEL);
  }

  const openai = createOpenAIProvider();

  if (provider === 'openai-responses') {
    /**
     * OpenAI Responses API。
     */
    return openai(MODEL);
  }

  /**
   * OpenAI Chat Completions 协议。
   */
  return openai.chat(MODEL);
}

export const model = createModel();
