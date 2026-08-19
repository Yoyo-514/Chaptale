import type { SessionMessageEntry } from './entry';
import { estimateMessageTokens } from './token-estimate';

/**
 * 压缩切点：从最新往回累积 token 到"保留近期"预算，落在合法切点上。
 *
 * `SessionCompactionEntry.firstKeptEntryId` 的语义是**保留区间的首条**，
 * 它之前的 message 折进摘要。此前赋的是压缩时刻的 leaf——也就是最后一条 entry，
 * 于是区间退化成 1：压缩后上下文只剩 `[摘要, 最后一条消息]`，近期原文全部丢弃。
 *
 * 合法切点只有一条硬约束：**不得落在 tool 结果上**。声明它的 assistant 一旦被折进
 * 摘要，这条结果就成了无主的孤儿——`tool-pairing` 会在读取侧丢弃它（否则 provider
 * 直接拒绝整个上下文），意味着切错点会静默吃掉本该保留的工具结果。
 *
 * 输入必须是 `buildContextProjection` 的产物而非原始路径：二次压缩时前一段已经
 * 折进摘要，按原始路径求下标会切回已折叠区间。
 */

/** 保留近期的默认预算；对小窗口模型按窗口比例收缩，避免预算大于窗口本身。 */
export function defaultKeepRecentTokens(contextWindow: number): number {
  return contextWindow > 0 ? Math.min(20_000, Math.floor(contextWindow * 0.25)) : 20_000;
}

export type CompactionCutPoint = {
  /** 保留区间首条 entry 的 id。 */
  firstKeptEntryId: string;
  /** 将被折进摘要的 message 条数；同时是 entries 上的切点下标。 */
  foldedCount: number;
};

/** 解析切点；返回 undefined 表示当前上下文没有值得折叠的内容。 */
export function resolveCompactionCutPoint(
  entries: SessionMessageEntry[],
  keepRecentTokens: number
): CompactionCutPoint | undefined {
  if (entries.length < 2) {
    return undefined;
  }

  let cutIndex = resolveBudgetCut(entries, keepRecentTokens);

  // 全部都在预算内：预算说"不必压缩"，但压缩是用户明确点的。
  // 退回"只保留最后一轮"，让手动压缩总能真的做点什么。
  if (cutIndex === 0) {
    cutIndex = lastTurnStart(entries);
  }

  cutIndex = backOffInvalidCut(entries, cutIndex);

  if (cutIndex <= 0) {
    return undefined;
  }

  return { firstKeptEntryId: entries[cutIndex]!.id, foldedCount: cutIndex };
}

/** 从最新往回累积，返回仍在预算内的最早下标。 */
function resolveBudgetCut(entries: SessionMessageEntry[], keepRecentTokens: number): number {
  const budget = Math.max(0, keepRecentTokens);
  let used = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    used += estimateMessageTokens(entries[index]!.message);

    if (used > budget) {
      // 本条已越界，保留区间从它的下一条开始。
      return index + 1;
    }
  }

  return 0;
}

/** 最后一个 user 消息的下标；没有则退回最后一条。 */
function lastTurnStart(entries: SessionMessageEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]!.message.role === 'user') {
      return index;
    }
  }

  return entries.length - 1;
}

/**
 * 把切点前移到合法位置。
 *
 * 只往前移不往后移：多保留内容永远是安全的，少保留会丢工具结果。
 */
function backOffInvalidCut(entries: SessionMessageEntry[], cutIndex: number): number {
  let index = Math.min(cutIndex, entries.length - 1);

  while (index > 0 && entries[index]!.message.role === 'tool') {
    index -= 1;
  }

  return index;
}
