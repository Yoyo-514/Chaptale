import { readFile } from 'node:fs/promises';

export type SessionUsageTotals = {
  totalTokens: number;
  totalCost: number;
};

type UsageCacheEntry = {
  modifiedMs: number;
  usage: SessionUsageTotals;
};

// list 每次都会扫全部会话文件，按 mtime 缓存避免重复解析未变化的 jsonl。
const usageCache = new Map<string, UsageCacheEntry>();

/** 从 pi jsonl 会话文件累计 assistant 消息的 token 与费用。 */
export async function readSessionUsage(filePath: string, modifiedMs: number): Promise<SessionUsageTotals> {
  const cached = usageCache.get(filePath);

  if (cached && cached.modifiedMs === modifiedMs) {
    return cached.usage;
  }

  const usage: SessionUsageTotals = { totalTokens: 0, totalCost: 0 };

  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    // 文件被并发删除等场景：返回零值且不写缓存
    return usage;
  }

  for (const line of content.split('\n')) {
    // 快速预筛：绝大多数行没有 usage 字段，跳过 JSON.parse
    if (!line.includes('"usage"')) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as {
        type?: string;
        message?: {
          role?: string;
          usage?: { totalTokens?: number; cost?: { total?: number } };
        };
      };

      if (entry.type !== 'message' || entry.message?.role !== 'assistant') {
        continue;
      }

      usage.totalTokens += entry.message.usage?.totalTokens ?? 0;
      usage.totalCost += entry.message.usage?.cost?.total ?? 0;
    } catch {
      // 跳过损坏行，不让单行错误拖垮整个列表
    }
  }

  usageCache.set(filePath, { modifiedMs, usage });
  return usage;
}
