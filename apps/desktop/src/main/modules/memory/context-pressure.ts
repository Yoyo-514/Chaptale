import type { MemoryContextPressureStatus } from '@chaptale/shared';

export const DEFAULT_CONTEXT_PRESSURE_THRESHOLD_PERCENT = 70;

export type RuntimeContextUsage = {
  /** SDK 在刚完成 compaction、尚无下一条 assistant usage 时返回 null。 */
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

/**
 * 把 SDK 水位转换为产品提示决策。
 *
 * 只依赖 SDK 已计算的 percent，避免用累计 session token（它含已压缩历史）误判；
 * compaction 后 usage 暂时未知时不提示，等下一次有效模型响应再重新判断。
 */
export function evaluateContextPressure(
  usage: RuntimeContextUsage,
  thresholdPercent = DEFAULT_CONTEXT_PRESSURE_THRESHOLD_PERCENT
): MemoryContextPressureStatus {
  return {
    ...usage,
    thresholdPercent,
    shouldPrompt: usage.percent !== null && usage.percent >= thresholdPercent
  };
}
