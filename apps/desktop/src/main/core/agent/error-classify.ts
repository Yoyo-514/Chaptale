/**
 * Provider 故障分类：把 AI SDK 上抛的原始错误归类，产出可操作的用户提示。
 *
 * 用途：chat 运行终态（`features/agent/ipc.ts` 的 failed 分支）——此前不区分成因，
 * 一律 `retryable: false` 且提示语与 401、断网、限流完全一致（"AI 回复失败" + 原始文本）。
 *
 * 证据取三处，按可靠性排序：
 * 1. **错误正文**（message + responseBody）走正则——最具体，能区分"429 但其实是配额"；
 * 2. **statusCode** 兜底——provider 的 message 常常只有 "Internal Server Error" 这类
 *    不带数字的文案，正则认不出，而状态码是确定的；
 * 3. **isRetryable**——SDK 自己的瞬时性判断，只在前两步都没结论时采信。
 *
 * 字段按鸭子类型读而不是 `APICallError.isInstance`：分类器保持零 SDK 依赖，
 * 且非 SDK 来源的同形错误（自有 HTTP 封装）也能受益。
 *
 * 正则顺序敏感（继承 doggo 的论证并扩充）：
 * - overflow 先于 rate-limit："context length limit" 同时含 "limit"；
 * - quota 先于 rate-limit："quota exceeded" 是账单问题，不是限流（pi 的教训：
 *   429 响应体若写的是配额文案，按限流重试只会反复失败）；
 * - auth 先于 upstream：403 与 5xx 的提示不同；
 * - timeout 先于 upstream：AI SDK 的超时错误文本可能含上游状态码。
 */

import { errorToMessage } from '@chaptale/shared';

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

/**
 * HTTP 状态码 → 分类：正文认不出时的兜底。
 *
 * 只映射语义明确的几档。429 归限流而非配额——正文写配额文案时正则已经先行截胡，
 * 走到这里说明没有更具体的证据。
 */
function classifyStatusCode(statusCode: number): ProviderFaultKind {
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode === 402) return 'quota';
  if (statusCode === 408) return 'timeout';
  if (statusCode === 429) return 'rate-limit';
  if (statusCode >= 500) return 'upstream';

  return 'unknown';
}

/**
 * 响应体只用于分类、不进用户可见消息，且截断后再喂正则。
 *
 * provider 出错时常返回整页 HTML；原样拼进提示会淹没可操作信息，
 * 全量喂正则也没必要——状态码与错误码都在开头。
 */
const MAX_MATCHED_BODY_CHARS = 2_000;

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
  const message = errorToMessage(error);
  const { statusCode, responseBody, isRetryable } = readTransportFields(error);
  const matched = responseBody ? `${message}\n${responseBody.slice(0, MAX_MATCHED_BODY_CHARS)}` : message;

  const fromText = classifyProviderFault(matched);
  const kind = fromText !== 'unknown' || statusCode === undefined ? fromText : classifyStatusCode(statusCode);

  if (kind === 'unknown') {
    // 分类不出时不编造提示；重试性交给 SDK 自己的瞬时性判断（缺省保守取 false）。
    return { kind, message, retryable: isRetryable === true };
  }

  return {
    kind,
    message: `${FAULT_HINTS[kind]}\n${message}`,
    retryable: RETRYABLE_KINDS.has(kind)
  };
}

/** AI SDK `APICallError` 的传输层字段（鸭子类型读取，见文件头）。 */
function readTransportFields(error: unknown): {
  statusCode?: number;
  responseBody?: string;
  isRetryable?: boolean;
} {
  if (typeof error !== 'object' || error === null) {
    return {};
  }

  const candidate = error as { statusCode?: unknown; responseBody?: unknown; isRetryable?: unknown };

  return {
    ...(typeof candidate.statusCode === 'number' ? { statusCode: candidate.statusCode } : {}),
    ...(typeof candidate.responseBody === 'string' ? { responseBody: candidate.responseBody } : {}),
    ...(typeof candidate.isRetryable === 'boolean' ? { isRetryable: candidate.isRetryable } : {})
  };
}
