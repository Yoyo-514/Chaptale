import type { ModelMessage } from 'ai';
import { createHash } from 'node:crypto';

import type { ProtocolModelSource } from './protocols';

export type PromptCachePolicy = 'provider-default' | 'openai-automatic' | 'openai-explicit' | 'anthropic';
export type PromptCacheMode = 'conversation' | 'stable-prefix';
type ProviderOptions = NonNullable<ModelMessage['providerOptions']>;

/** 自定义兼容地址可能只实现部分协议，不能仅凭供应商名字发送扩展字段。 */
export function resolvePromptCachePolicy(
  source: Pick<ProtocolModelSource, 'api' | 'baseUrl'>,
  modelId: string
): PromptCachePolicy {
  let url: URL;
  try {
    url = new URL(source.baseUrl ?? '');
  } catch {
    return 'provider-default';
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return 'provider-default';
  if (source.api === 'anthropic-messages' && url.hostname === 'api.anthropic.com') return 'anthropic';
  if (source.api !== 'openai-responses' || url.hostname !== 'api.openai.com') return 'provider-default';
  const version = /^gpt-(\d+)(?:\.(\d+))?(?:-|$)/.exec(modelId);
  return version && (Number(version[1]) > 5 || (Number(version[1]) === 5 && Number(version[2] ?? 0) >= 6))
    ? 'openai-explicit'
    : 'openai-automatic';
}

export type CachedPrompt = {
  instructions?: string;
  messages: ModelMessage[];
  providerOptions?: ProviderOptions;
};

/** 只改本次请求投影，不把 provider 标记写进历史，也不提升参考文本的消息权限。 */
export function buildCachedPrompt(input: {
  policy?: PromptCachePolicy;
  mode?: PromptCacheMode;
  scope: string;
  system: string;
  messages: ModelMessage[];
  contextPrefix?: string;
}): CachedPrompt {
  const policy = input.policy ?? 'provider-default';
  const conversation: ModelMessage[] = [
    ...(input.contextPrefix ? [{ role: 'user' as const, content: input.contextPrefix }] : []),
    ...input.messages
  ];
  if (policy === 'provider-default') return { instructions: input.system, messages: conversation };

  const promptCacheKey = `chaptale-v1:${createHash('sha256').update(input.scope).digest('hex').slice(0, 48)}`;
  if (policy === 'openai-automatic') {
    return {
      instructions: input.system,
      messages: conversation,
      providerOptions: { openai: { promptCacheKey } }
    };
  }

  const marker: ProviderOptions =
    policy === 'anthropic'
      ? { anthropic: { cacheControl: { type: 'ephemeral' } } }
      : { openai: { promptCacheBreakpoint: { mode: 'explicit' } } };
  const stableOnly = input.mode === 'stable-prefix';
  if (input.contextPrefix) conversation[0] = markMessage(conversation[0]!, marker);
  if (!stableOnly) {
    // 保留前两处历史边界，当前末尾交给自动断点；连同 system 最多四处。
    const eligible = conversation.flatMap((message, index) =>
      message.role === 'user' || message.role === 'tool' ? [index] : []
    );
    const prior = eligible.slice(0, -1).slice(input.contextPrefix ? -1 : -2);
    for (const index of prior) conversation[index] = markMessage(conversation[index]!, marker);
  }
  return {
    messages: [
      ...(input.system ? [markMessage({ role: 'system', content: input.system }, marker)] : []),
      ...conversation
    ],
    providerOptions:
      policy === 'anthropic'
        ? stableOnly
          ? undefined
          : { anthropic: { cacheControl: { type: 'ephemeral' } } }
        : { openai: { promptCacheKey, promptCacheOptions: { mode: stableOnly ? 'explicit' : 'implicit' } } }
  };
}

function markMessage(message: ModelMessage, marker: ProviderOptions): ModelMessage {
  if (message.role === 'system') {
    return { ...message, providerOptions: mergeOptions(message.providerOptions, marker) };
  }
  if (typeof message.content === 'string') {
    if (message.role !== 'user' && message.role !== 'assistant') return message;
    return { ...message, content: [{ type: 'text', text: message.content, providerOptions: marker }] };
  }
  const last = message.content.findLastIndex(part => ['text', 'tool-result', 'file', 'image'].includes(part.type));
  const content = message.content.map((part, index) => {
    if (index !== last) return part;
    return {
      ...part,
      providerOptions: mergeOptions('providerOptions' in part ? part.providerOptions : undefined, marker)
    };
  });
  return { ...message, content } as ModelMessage;
}

function mergeOptions(options: ModelMessage['providerOptions'], marker: ProviderOptions): ProviderOptions {
  const merged = { ...options };
  for (const [provider, values] of Object.entries(marker)) {
    merged[provider] = { ...options?.[provider], ...values };
  }
  return merged;
}
