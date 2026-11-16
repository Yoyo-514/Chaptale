import type { RetryState } from '@chaptale/agent-host/protocol';

export interface FormattedAgentError {
  /** 第一层：面向作者的简短中文主因。 */
  summary: string;
  /** 第二层：有额外原始技术细节时非空，供折叠查看与复制。 */
  detail?: string;
  /** 鉴权失败、未配置供应商密钥或模型缺失时为 true，附带“模型设置”入口。 */
  needsModelSettings: boolean;
}

const statusPattern = /(?:^|\b(?:status|http)\s*[:=]?\s*|\()([45]\d{2})(?:\b|\))/iu;
const htmlPattern = /<!doctype\s+html|<html[\s>]/iu;
const authPattern =
  /\b(?:invalid[_\s-]?api[_\s-]?key|incorrect\s+api\s+key|authentication|unauthorized|forbidden|no\s+api\s+key)\b/iu;
const quotaPattern = /\b(?:insufficient[_\s-]?(?:balance|quota)|credit\s+balance|billing)\b/iu;
const contextPattern =
  /\b(?:context_length_exceeded|maximum\s+context\s+length|prompt\s+is\s+too\s+long|too\s+many\s+tokens)\b/iu;
const ratePattern = /\b(?:rate[_\s-]?limit|too\s+many\s+requests)\b/iu;
const notFoundPattern = /\b(?:model_not_found|does\s+not\s+exist)\b/iu;
const serverPattern = /\b(?:overloaded|bad\s+gateway|service\s+unavailable|gateway\s+timeout)\b/iu;
const networkPattern =
  /\b(?:fetch\s+failed|econnrefused|enotfound|etimedout|econnreset|network\s+error|socket\s+hang\s+up)\b/iu;

function extractJsonMessage(raw: string): string | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    const inner = record.error;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
    if (inner && typeof inner === 'object') {
      const msg = (inner as Record<string, unknown>).message;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  } catch {
    return undefined;
  }
  return undefined;
}

function finalize(summary: string, raw: string, needsModelSettings = false): FormattedAgentError {
  const trimmed = raw.trim();
  return {
    summary,
    detail: trimmed && trimmed !== summary ? trimmed : undefined,
    needsModelSettings
  };
}

/** 把模型运行时、HTTP 网关与宿主抛出的错误整理为“中文主因 + 可选原始详情”。 */
export function formatAgentError(raw: string): FormattedAgentError {
  const text = raw.trim();
  if (!text) return { summary: '模型请求未完成', needsModelSettings: false };

  if (text === '请先选择模型' || text === '所选模型不可用' || text.includes('API 密钥')) {
    return finalize(text, text, true);
  }

  const status = text.match(statusPattern)?.[1];
  if (contextPattern.test(text) || status === '413') {
    return finalize('上下文长度超出模型上限，请先压缩对话或开启新会话', text);
  }
  if (status === '401' || status === '403' || authPattern.test(text)) {
    const tag = status ? `（${status}）` : '';
    return finalize(`模型鉴权未通过${tag}，请检查 API 密钥或权限`, text, true);
  }
  if (status === '402' || quotaPattern.test(text)) {
    const tag = status ? `（${status}）` : '';
    return finalize(`供应商账户余额或额度不足${tag}`, text);
  }
  if (status === '429' || ratePattern.test(text)) {
    const tag = status === '429' ? '（429）' : '';
    return finalize(`请求过快或触发供应商限流${tag}`, text);
  }
  if (status === '404' || notFoundPattern.test(text)) {
    const tag = status ? `（${status}）` : '';
    return finalize(`请求的模型或接口地址不存在${tag}，请检查模型设置`, text, true);
  }
  if ((status && status.startsWith('5')) || serverPattern.test(text)) {
    const tag = status ? `（${status}）` : '';
    return finalize(`供应商服务暂时繁忙或不可用${tag}`, text);
  }
  if (networkPattern.test(text)) {
    return finalize('无法连接模型服务，请检查网络或接口地址', text);
  }

  if (htmlPattern.test(text)) {
    const tag = status ? `（${status}）` : '';
    return finalize(`模型服务返回异常页面${tag}`, text);
  }

  const jsonMsg = extractJsonMessage(text);
  if (jsonMsg) {
    const prefix = status === '400' ? '请求参数被拒绝（400）：' : status ? `请求失败（${status}）：` : '';
    const line = `${prefix}${jsonMsg}`;
    const summary = line.length > 96 ? `${line.slice(0, 95)}…` : line;
    return finalize(summary, text);
  }

  const firstLine = text.split(/\r?\n/u)[0]!.trim();
  const summary = firstLine.length > 96 ? `${firstLine.slice(0, 95)}…` : firstLine;
  return finalize(summary, text);
}

/** 生成自动退避重试状态栏文案，带出简短失败原因与当前次数。 */
export function formatRetryStatus(retrying: RetryState): string {
  const { summary } = formatAgentError(retrying.errorMessage);
  const brief = summary.replace(/，请.+$/u, '');
  return `${brief}，正在自动重试（${retrying.attempt}/${retrying.maxAttempts}）…`;
}
