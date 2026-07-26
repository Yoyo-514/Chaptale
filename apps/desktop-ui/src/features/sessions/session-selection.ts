import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

export type SessionSelectionInput = {
  /** 当前 cwd 过滤后的候选会话。 */
  candidates: ChaptaleSessionListItem[];
  /** 全量会话列表；已恢复状态下显式跨 workspace 选择依赖它判断存活。 */
  allSessions: ChaptaleSessionListItem[];
  currentSessionId: string;
  selectionRestored: boolean;
  persistedSessionId: string;
};

export type SessionSelectionResult = {
  nextSessionId: string;
  shouldPersist: boolean;
};

/**
 * 会话选择恢复规则（纯函数，与列表加载 IO 解耦）：
 * - 首次恢复：运行期选择优先于持久化选择，二者都不在候选中则回退候选第一个；
 * - 已恢复：仅当当前选择从全量列表消失才回退，保留显式跨 workspace 选择。
 */
export function resolveSessionSelection(input: SessionSelectionInput): SessionSelectionResult {
  if (!input.selectionRestored) {
    const candidateId = input.currentSessionId || input.persistedSessionId;
    const nextSessionId = input.candidates.some(session => session.id === candidateId)
      ? candidateId
      : (input.candidates[0]?.id ?? '');

    return { nextSessionId, shouldPersist: nextSessionId !== input.persistedSessionId };
  }

  if (!input.allSessions.some(session => session.id === input.currentSessionId)) {
    return { nextSessionId: input.candidates[0]?.id ?? '', shouldPersist: true };
  }

  return { nextSessionId: input.currentSessionId, shouldPersist: false };
}
