import type { DocumentPosition, EditorGroupIndex, EditorGroupState, WorkViewState } from '@chaptale/creation/contracts';

export type GroupTabEntry = DocumentPosition & { documentId: string };

function emptyPosition(documentId: string): GroupTabEntry {
  return { documentId, anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0 };
}

export function createEmptyGroups(): [EditorGroupState] {
  return [{ tabs: [], activeDocumentId: null }];
}

export function allOpenDocumentIds(state: WorkViewState): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const group of state.groups) {
    for (const tab of group.tabs) {
      if (!seen.has(tab.documentId)) {
        seen.add(tab.documentId);
        ids.push(tab.documentId);
      }
    }
  }
  return ids;
}

export function countDocumentOccurrences(state: WorkViewState, documentId: string): number {
  let count = 0;
  for (const group of state.groups) {
    if (group.tabs.some(tab => tab.documentId === documentId)) count += 1;
  }
  return count;
}

export function ensureTabInGroup(
  state: WorkViewState,
  groupIndex: EditorGroupIndex,
  documentId: string,
  initial?: DocumentPosition
): GroupTabEntry {
  const group = state.groups[groupIndex] ?? state.groups[0];
  let existing = group.tabs.find(tab => tab.documentId === documentId);
  if (!existing) {
    existing = initial ? { documentId, ...initial } : emptyPosition(documentId);
    group.tabs.push(existing);
  }
  return existing;
}

export function activateTabInGroup(
  state: WorkViewState,
  groupIndex: EditorGroupIndex,
  documentId: string,
  initial?: DocumentPosition
) {
  const targetIndex: EditorGroupIndex = state.groups[groupIndex] ? groupIndex : 0;
  ensureTabInGroup(state, targetIndex, documentId, initial);
  state.groups[targetIndex]!.activeDocumentId = documentId;
  state.activeGroup = targetIndex;
}

/** 向右拆分：确保存在第二编辑组，并将指定文档在右侧组打开且聚焦右侧组（左侧原标签保留，支持同文稿双开）。 */
export function splitTabToRightGroup(
  state: WorkViewState,
  documentId: string,
  sourceGroup: EditorGroupIndex = state.activeGroup
) {
  const origin = state.groups[sourceGroup]?.tabs.find(tab => tab.documentId === documentId);
  if (state.groups.length === 1) {
    state.groups = [state.groups[0], { tabs: [], activeDocumentId: null }];
  }
  const initial = origin
    ? { anchor: origin.anchor, head: origin.head, scrollTop: origin.scrollTop, scrollLeft: origin.scrollLeft }
    : undefined;
  activateTabInGroup(state, 1, documentId, initial);
}

/** 在侧边组打开文档：若当前组为空则直接打开在当前组，否则打开在另一编辑组并聚焦。 */
export function openTabInSideGroup(state: WorkViewState, documentId: string) {
  if (state.groups.length === 1 && state.groups[0].tabs.length === 0) {
    activateTabInGroup(state, 0, documentId);
    return;
  }
  if (state.groups.length === 1) {
    splitTabToRightGroup(state, documentId, 0);
    return;
  }
  const target: EditorGroupIndex = state.activeGroup === 0 ? 1 : 0;
  activateTabInGroup(state, target, documentId);
}

export interface RemoveGroupTabResult {
  remainingCount: number;
  /** 若某组因最后一个标签关闭而合并回单栏，记录保留下来的原组下标（0 或 1）。 */
  keptGroupAfterCollapse?: EditorGroupIndex;
}

/** 关闭指定编辑组内的单个标签；若该组清空且原本有两组，自动合并回单栏。 */
export function closeTabInGroup(
  state: WorkViewState,
  groupIndex: EditorGroupIndex,
  documentId: string
): RemoveGroupTabResult {
  const group = state.groups[groupIndex];
  if (!group) return { remainingCount: countDocumentOccurrences(state, documentId) };
  group.tabs = group.tabs.filter(tab => tab.documentId !== documentId);
  if (group.activeDocumentId === documentId) {
    group.activeDocumentId = group.tabs.at(-1)?.documentId ?? null;
  }
  let keptGroupAfterCollapse: EditorGroupIndex | undefined;
  if (state.groups.length === 2 && group.tabs.length === 0) {
    const keptIndex: EditorGroupIndex = groupIndex === 0 ? 1 : 0;
    state.groups = [state.groups[keptIndex]!];
    state.activeGroup = 0;
    keptGroupAfterCollapse = keptIndex;
  } else if (state.groups.length === 2 && state.activeGroup === groupIndex && !group.activeDocumentId) {
    state.activeGroup = groupIndex === 0 ? 1 : 0;
  }
  return {
    remainingCount: countDocumentOccurrences(state, documentId),
    keptGroupAfterCollapse
  };
}
