import type { ChaptaleCustomProviderApi } from '@chaptale/ipc-contract';

/** UI「添加供应商」的填表模板：仅 baseUrl + 协议建议，不是模型目录。 */
export type ProviderPreset = {
  id: string;
  label: string;
  api: ChaptaleCustomProviderApi;
  baseUrl: string;
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', api: 'openai-completions', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'moonshot', label: '月之暗面', api: 'openai-completions', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'openrouter', label: 'OpenRouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'openai', label: 'OpenAI', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com' },
  {
    id: 'google',
    label: 'Google',
    api: 'google-generative-ai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
  },
  { id: 'compatible', label: 'OpenAI 兼容站', api: 'openai-completions', baseUrl: '' }
] as const;
