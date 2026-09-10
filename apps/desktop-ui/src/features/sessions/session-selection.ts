import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

export type SessionSelectionInput = {
  /** 当前 cwd 过滤后的候选会话。 */
  candidates: ChaptaleSessionListItem[];
  /** 全量会话列表；存活判断一律用它，跨 workspace/global 的选择不被 cwd 过滤误伤。 */
  allSessions: ChaptaleSessionListItem[];
  currentSessionId: string;
  selectionRestored: boolean;
  /** 当前作品的持久化槽位（主进程 getState 按当前作品合成）。 */
  persistedSessionId: string;
};

export type SessionSelectionResult = {
  nextSessionId: string;
  shouldPersist: boolean;
};

/**
 * 会话选择恢复规则（纯函数，与列表加载 IO 解耦）：
 * - 首次恢复：运行期选择优先，其次当前作品槽位（全量列表判断存活，从历史点进来的其他作品会话
 *   不被 cwd 候选过滤丢弃）；都不存活回退候选第一个。
 * - 已恢复：运行期选择存活即保留；失效（含 bindCwd 换作品清空）回退候选第一个——槽位不参与，
 *   避免换作品后跳回上一部作品的会话。
 *
 * 两条路径都只在结果与槽位不一致时才要求写回：改完才发现槽位里早就存的是这个会话（甚至两边都
 * 为空）时，多写一次 IPC 既无意义，也会让"没打开作品"这种状态去动它本来就没有的槽位。
 */
export function resolveSessionSelection(input: SessionSelectionInput): SessionSelectionResult {
  if (!input.selectionRestored) {
    const candidateId = input.currentSessionId || input.persistedSessionId;

    if (candidateId && input.allSessions.some(session => session.id === candidateId)) {
      return { nextSessionId: candidateId, shouldPersist: candidateId !== input.persistedSessionId };
    }

    const fallbackId = input.candidates[0]?.id ?? '';
    return { nextSessionId: fallbackId, shouldPersist: fallbackId !== input.persistedSessionId };
  }

  if (input.currentSessionId && input.allSessions.some(session => session.id === input.currentSessionId)) {
    return { nextSessionId: input.currentSessionId, shouldPersist: false };
  }

  const fallbackId = input.candidates[0]?.id ?? '';

  return { nextSessionId: fallbackId, shouldPersist: fallbackId !== input.persistedSessionId };
}
