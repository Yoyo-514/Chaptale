import type { RecordedTokenUsage } from '@chaptale/shared';

function value(tokens: number | undefined): string {
  return tokens === undefined ? '未返回' : `${tokens.toLocaleString()} tokens`;
}

export function tokenUsageRows(usage: RecordedTokenUsage): Array<{ label: string; value: string }> {
  return [
    { label: '输入总计', value: value(usage.inputTokens) },
    { label: '输出', value: value(usage.outputTokens) },
    { label: '缓存读取', value: value(usage.cache?.readTokens) },
    { label: '缓存写入', value: value(usage.cache?.writeTokens) },
    { label: '未缓存输入', value: value(usage.cache?.uncachedTokens) }
  ];
}

export function formatTokenUsageDetails(usage: RecordedTokenUsage): string {
  return [
    ...tokenUsageRows(usage).map(row => `${row.label}：${row.value}`),
    ...(usage.cache?.partial ? ['部分步骤未返回缓存指标，数值为已报告部分。'] : [])
  ].join('\n');
}
