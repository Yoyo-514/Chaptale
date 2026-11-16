import { describe, expect, it } from 'vitest';

import { formatAgentError, formatRetryStatus } from '../error-format';

describe('formatAgentError', () => {
  it('识别 401/403 与鉴权 JSON，提炼中文主因、保留原始详情并标记需要模型设置', () => {
    const raw = '401 {"error":{"message":"Incorrect API key provided: sk-***","type":"invalid_request_error"}}';
    expect(formatAgentError(raw)).toEqual({
      summary: '模型鉴权未通过（401），请检查 API 密钥或权限',
      detail: raw,
      needsModelSettings: true
    });
  });

  it('宿主前置未配置密钥中文提示直接作为主因，不重复附带相同原始详情，并标记需要模型设置', () => {
    const raw = '未配置供应商“deepseek”的 API 密钥，请在模型设置中填写后重试';
    expect(formatAgentError(raw)).toEqual({
      summary: raw,
      detail: undefined,
      needsModelSettings: true
    });
    expect(formatAgentError('请先选择模型')).toEqual({
      summary: '请先选择模型',
      detail: undefined,
      needsModelSettings: true
    });
  });

  it('识别 402 余额不足、404 模型不存在、413 上下文超限、429 限流与 5xx HTML 网关页', () => {
    expect(formatAgentError('402 {"error":{"message":"Insufficient Balance"}}')).toMatchObject({
      summary: '供应商账户余额或额度不足（402）',
      needsModelSettings: false
    });
    expect(formatAgentError('404 {"error":{"code":"model_not_found","message":"Model foo does not exist"}}')).toEqual({
      summary: '请求的模型或接口地址不存在（404），请检查模型设置',
      detail: '404 {"error":{"code":"model_not_found","message":"Model foo does not exist"}}',
      needsModelSettings: true
    });
    expect(
      formatAgentError('400 {"error":{"code":"context_length_exceeded","message":"This model maximum context length"}}')
    ).toMatchObject({
      summary: '上下文长度超出模型上限，请先压缩对话或开启新会话',
      needsModelSettings: false
    });
    expect(formatAgentError('429 {"error":{"message":"Rate limit reached"}}')).toMatchObject({
      summary: '请求过快或触发供应商限流（429）',
      needsModelSettings: false
    });
    const gatewayHtml = '502 <!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>';
    expect(formatAgentError(gatewayHtml)).toEqual({
      summary: '供应商服务暂时繁忙或不可用（502）',
      detail: gatewayHtml,
      needsModelSettings: false
    });
  });

  it('识别网络连接异常与普通 JSON 错误字段提取', () => {
    expect(formatAgentError('TypeError: fetch failed (ECONNREFUSED 127.0.0.1:11434)')).toEqual({
      summary: '无法连接模型服务，请检查网络或接口地址',
      detail: 'TypeError: fetch failed (ECONNREFUSED 127.0.0.1:11434)',
      needsModelSettings: false
    });
    const paramErr = '400 {"error":{"message":"temperature must be between 0 and 2"}}';
    expect(formatAgentError(paramErr)).toEqual({
      summary: '请求参数被拒绝（400）：temperature must be between 0 and 2',
      detail: paramErr,
      needsModelSettings: false
    });
  });

  it('格式化自动重试状态时带出简短失败原因与重试次数', () => {
    expect(
      formatRetryStatus({
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2000,
        errorMessage: '429 rate limit exceeded'
      })
    ).toBe('请求过快或触发供应商限流（429），正在自动重试（1/3）…');
    expect(
      formatRetryStatus({
        attempt: 2,
        maxAttempts: 3,
        delayMs: 4000,
        errorMessage: 'fetch failed: ETIMEDOUT'
      })
    ).toBe('无法连接模型服务，正在自动重试（2/3）…');
  });
});
