import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

export type SessionSelectionInput = {
  /** 当前 cwd 过滤后的候选会话。 */
  candidates: ChaptaleSessionListItem[];
  /** 全量会话列表；存活判断一律用它，跨 workspace/global 的选择不被 cwd 过滤误伤。 */
  allSessions: ChaptaleSessionListItem[];
  currentSessionId: string;
  selectionRestored: boolean;
  /** 当前存储域的持久化槽位（主进程 getState 合成）。 */
  persistedSessionId: string;
};

export type SessionSelectionResult = {
  nextSessionId: string;
  shouldPersist: boolean;
};

/**
 * 会话选择恢复规则（纯函数，与列表加载 IO 解耦）：
 * - 首次恢复：运行期选择优先，其次当前域槽位（全量列表判断存活，跨 workspace/global 的槽位不被
 *   cwd 候选过滤丢弃）；都不存活回退候选第一个。
 * - 已恢复：运行期选择存活即保留；失效（含 bindCwd 切域清空）回退候选第一个——槽位不参与，
 *   避免切域后跳回其他域的会话。
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

  return { nextSessionId: input.candidates[0]?.id ?? '', shouldPersist: true };
}
