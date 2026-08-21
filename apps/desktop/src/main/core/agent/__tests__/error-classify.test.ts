import { describe, expect, it } from 'vitest';

import { classifyProviderFault, describeProviderFault } from '../error-classify';

describe('classifyProviderFault', () => {
  it.each([
    ['401 Unauthorized', 'auth'],
    ['invalid api key', 'auth'],
    ['403 Forbidden', 'auth'],
    ['quota exceeded', 'quota'],
    ['insufficient_quota', 'quota'],
    ['Rate limit reached', 'rate-limit'],
    ['429 Too Many Requests', 'rate-limit'],
    ['ThrottlingException: Too many tokens, please wait', 'rate-limit'],
    ['context length limit exceeded', 'context-overflow'],
    ['This model maximum context length is 8192 tokens', 'context-overflow'],
    ['context_length_exceeded', 'context-overflow'],
    ['Request timed out', 'timeout'],
    ['ETIMEDOUT', 'timeout'],
    ['deadline exceeded', 'timeout'],
    ['502 Bad Gateway', 'upstream'],
    ['service unavailable', 'upstream'],
    ['ECONNREFUSED', 'network'],
    ['fetch failed', 'network'],
    ['getaddrinfo ENOTFOUND api.example.com', 'network']
  ])('%s → %s', (message, expected) => {
    expect(classifyProviderFault(message)).toBe(expected);
  });

  it('未命中任何分类时返回 unknown', () => {
    expect(classifyProviderFault('结构不完整：<output> 标签缺失')).toBe('unknown');
    expect(classifyProviderFault('')).toBe('unknown');
  });

  it('顺序敏感：同时含 limit 的溢出文案不落入 rate-limit', () => {
    // "context length limit exceeded" 同时含 "limit"，溢出分类必须先行。
    expect(classifyProviderFault('context length limit exceeded')).toBe('context-overflow');
  });

  it('顺序敏感：同时含 429 的配额文案不落入 rate-limit', () => {
    // 429 响应体写配额文案时按账单处理，按限流重试只会反复失败。
    expect(classifyProviderFault('429: quota exceeded')).toBe('quota');
  });
});

describe('describeProviderFault', () => {
  it('分类命中：消息 = 可操作提示 + 原文，可重试性按成因', () => {
    const auth = describeProviderFault(new Error('401 Unauthorized'));
    expect(auth.kind).toBe('auth');
    expect(auth.message).toContain('设置 → 模型');
    expect(auth.message).toContain('401 Unauthorized');
    expect(auth.retryable).toBe(false);

    const upstream = describeProviderFault(new Error('502 Bad Gateway'));
    expect(upstream.kind).toBe('upstream');
    expect(upstream.retryable).toBe(true);
  });

  it('瞬时故障类可重试，配置/账单/上下文类不可重试', () => {
    const retryableSamples: Array<[string, string]> = [
      ['rate-limit', '429 Too Many Requests'],
      ['timeout', 'Request timed out'],
      ['upstream', '502 Bad Gateway'],
      ['network', 'fetch failed']
    ];

    for (const [kind, sample] of retryableSamples) {
      expect(describeProviderFault(new Error(sample))).toMatchObject({ kind, retryable: true });
    }

    const nonRetryableSamples: Array<[string, string]> = [
      ['auth', '401 Unauthorized'],
      ['quota', 'insufficient_quota'],
      ['context-overflow', 'context_length_exceeded']
    ];

    for (const [kind, sample] of nonRetryableSamples) {
      expect(describeProviderFault(new Error(sample))).toMatchObject({ kind, retryable: false });
    }

    expect(describeProviderFault(new Error('随便什么错')).retryable).toBe(false);
  });

  it('unknown：消息为原文，不可重试（保守）', () => {
    const failure = describeProviderFault('非 Error 的未知失败');
    expect(failure).toEqual({ kind: 'unknown', message: '非 Error 的未知失败', retryable: false });
  });
});

/**
 * provider 的 message 常常不带数字状态码（"Internal Server Error"、"Unauthorized"
 * 之外还有一堆自定义文案），只匹配 message 会让分类在真实故障上大面积落回 unknown。
 * APICallError 把状态码与响应体单独带着，是比文本更可靠的证据。
 */
function apiCallError(fields: { message: string; statusCode?: number; responseBody?: string; isRetryable?: boolean }) {
  return Object.assign(new Error(fields.message), {
    ...(fields.statusCode === undefined ? {} : { statusCode: fields.statusCode }),
    ...(fields.responseBody === undefined ? {} : { responseBody: fields.responseBody }),
    ...(fields.isRetryable === undefined ? {} : { isRetryable: fields.isRetryable })
  });
}

describe('describeProviderFault：结构化传输字段', () => {
  it('message 认不出时按 statusCode 兜底', () => {
    // 正则在 "Internal Server Error" 上无处下手：没有数字、没有关键词。
    expect(describeProviderFault(apiCallError({ message: 'Internal Server Error', statusCode: 500 }))).toMatchObject({
      kind: 'upstream',
      retryable: true
    });

    expect(describeProviderFault(apiCallError({ message: '请求被拒绝', statusCode: 401 }))).toMatchObject({
      kind: 'auth',
      retryable: false
    });

    // 402 Payment Required：正文通常什么都不写，只有状态码能认出是账单问题。
    expect(describeProviderFault(apiCallError({ message: '', statusCode: 402 }))).toMatchObject({ kind: 'quota' });
  });

  it('响应体参与分类：429 的配额文案压过状态码的限流默认值', () => {
    const failure = describeProviderFault(
      apiCallError({
        message: 'Request failed',
        statusCode: 429,
        responseBody: '{"error":{"message":"You exceeded your current quota, please check your billing"}}'
      })
    );

    // 按限流提示"稍后重试"会让用户反复撞同一堵墙。
    expect(failure).toMatchObject({ kind: 'quota', retryable: false });
  });

  it('响应体只参与分类，不进用户可见消息', () => {
    const failure = describeProviderFault(
      apiCallError({ message: '上游异常', statusCode: 503, responseBody: '<html>整页错误页</html>'.repeat(500) })
    );

    expect(failure.kind).toBe('upstream');
    expect(failure.message).not.toContain('整页错误页');
  });

  it('分类不出但 SDK 判定可瞬时重试时，采信 SDK', () => {
    expect(describeProviderFault(apiCallError({ message: '未知抖动', isRetryable: true }))).toMatchObject({
      kind: 'unknown',
      retryable: true
    });
  });
});
