/**
 * Provider 故障分类：把 AI SDK 上抛的原始错误归类，产出可操作的用户提示。
 *
 * 用途：chat 运行终态（`features/agent/ipc.ts` 的 failed 分支）——此前不区分成因，
 * 一律 `retryable: false` 且提示语与 401、断网、限流完全一致（"AI 回复失败" + 原始文本）。
 *
 * 匹配对象是 `errorToMessage` 之后的字符串：SDK 的错误 message 已含 provider 的
 * 状态码或正文片段（如 "URL fetch failed: ..."），正则直接在文本上工作；
 * JSON 化的错误体不影响匹配（正则不需要结构）。
 *
 * 顺序敏感（继承 doggo 的论证并扩充）：
 * - overflow 先于 rate-limit："context length limit" 同时含 "limit"；
 * - quota 先于 rate-limit："quota exceeded" 是账单问题，不是限流（pi 的教训：
 *   429 响应体若写的是配额文案，按限流重试只会反复失败）；
 * - auth 先于 upstream：403 与 5xx 的提示不同；
 * - timeout 先于 upstream：AI SDK 的超时错误文本可能含上游状态码。
 */

export type ProviderFaultKind =
  | 'auth'
  | 'quota'
  | 'rate-limit'
  | 'context-overflow'
  | 'timeout'
  | 'upstream'
  | 'network'
  | 'unknown';

type FaultRule = { kind: Exclude<ProviderFaultKind, 'unknown'>; pattern: RegExp };

const FAULT_RULES: readonly FaultRule[] = [
  {
    kind: 'context-overflow',
    pattern: /context.{0,24}(length|window|limit)|maximum (context|input)|prompt is too long|context_length_exceeded/i
  },
  {
    kind: 'quota',
    pattern: /quota exceeded|insufficient_quota|out of budget|available balance|usage limit|billing/i
  },
  { kind: 'rate-limit', pattern: /rate.?limit|too many requests|\b429\b|throttl/i },
  {
    kind: 'auth',
    pattern: /\b40[13]\b|unauthorized|forbidden|invalid.{0,16}(api.?key|token)|authentication|api key/i
  },
  { kind: 'timeout', pattern: /\btimed? ?out\b|timeout|ETIMEDOUT|deadline exceeded/i },
  { kind: 'upstream', pattern: /\b5\d\d\b|bad gateway|service unavailable|overloaded|server_error/i },
  {
    kind: 'network',
    pattern: /ECONN\w+|ENOTFOUND|EAI_AGAIN|EPIPE|fetch failed|connection (reset|refused)|getaddrinfo|socket hang up/i
  }
];

/** 各分类的可操作提示；unknown 无提示，直接展示原文。 */
const FAULT_HINTS: Record<Exclude<ProviderFaultKind, 'unknown'>, string> = {
  auth: 'API key 无效或权限不足，请到「设置 → 模型」检查配置',
  quota: '账户配额或余额不足，请检查账户或更换模型',
  'rate-limit': '请求过于频繁触发限流，稍后重试或更换模型',
  'context-overflow': '上下文超出模型窗口，请压缩会话或减少本轮内容',
  timeout: '请求超时，模型响应过慢，稍后重试',
  upstream: '上游服务繁忙，请稍后重试',
  network: '网络连接失败，请检查网络后重试'
};

/** 可重试性：配置/账单/上下文类重试无意义，瞬时故障类允许用户手动重发。 */
const RETRYABLE_KINDS = new Set<ProviderFaultKind>(['rate-limit', 'timeout', 'upstream', 'network']);

export type ProviderFaultDescription = {
  kind: ProviderFaultKind;
  /** 面向用户的消息：分类命中时 = 提示 + 原文，未命中时 = 原文。 */
  message: string;
  /** 是否值得用户手动重试（AI SDK 已内置过请求级重试，此处的重试指重发一轮）。 */
  retryable: boolean;
};

export function classifyProviderFault(message: string): ProviderFaultKind {
  for (const rule of FAULT_RULES) {
    if (rule.pattern.test(message)) {
      return rule.kind;
    }
  }

  return 'unknown';
}

export function describeProviderFault(error: unknown): ProviderFaultDescription {
  const message = error instanceof Error ? error.message : String(error);
  const kind = classifyProviderFault(message);

  if (kind === 'unknown') {
    return { kind, message, retryable: false };
  }

  return {
    kind,
    message: `${FAULT_HINTS[kind]}\n${message}`,
    retryable: RETRYABLE_KINDS.has(kind)
  };
}
