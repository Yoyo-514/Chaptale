import type { ParsedSessionFile, SessionEntry, SessionMessage } from './entry';

/**
 * 状态回放：append-only 事件流 → 当前 leaf 路径 → 模型上下文消息。
 *
 * 范式：状态 = 沿 parentId 路径回放事件；分支 = 树上前缀共享；
 * compaction = 流内摘要事件（前缀 message 折叠为 summary 文本）。
 */

/** 路径回放结果：leaf 到根的有序 entry 列表 + 生效 compaction。 */
export type ReplayResult = {
  /** 根 → leaf 顺序。 */
  path: SessionEntry[];
  leafId: string | null;
  /** 路径上最后一条 compaction；无则 undefined。 */
  effectiveCompaction: Extract<SessionEntry, { type: 'compaction' }> | undefined;
};

/** 自然 leaf：最后一条非 branch entry（marker 不参与）；branch_selected(null) 的解析目标。 */
export function resolveNaturalLeafId(entries: SessionEntry[]): string | null {
  let natural: string | null = null;

  for (const entry of entries) {
    if (entry.type !== 'branch_selected') {
      natural = entry.id;
    }
  }

  return natural;
}

/**
 * 解析当前 leaf：顺序折叠全部 entry，与 SessionStore 写入行为严格镜像——
 * 非 branch entry → 活动 leaf 前移；branch_selected(target) → 活动 leaf 切换；
 * branch_selected(null) → 回到当时的自然 leaf（此前最后一条非 branch entry）。
 * 切换后再 append 的新分支自然接管活动 leaf，不会停留在旧 marker 上。
 */
export function resolveLeafId(entries: SessionEntry[]): string | null {
  let current: string | null = null;
  let natural: string | null = null;

  for (const entry of entries) {
    if (entry.type === 'branch_selected') {
      current = entry.targetId ?? natural;
    } else {
      natural = entry.id;
      current = entry.id;
    }
  }

  return current;
}

/** 沿 parentId 从 leaf 回溯到根；leaf 未知（悬空/截断）时回退自然 leaf。 */
export function getPathToRoot(file: ParsedSessionFile, leafId?: string | null): SessionEntry[] {
  const entries = file.entries;
  const resolvedLeaf = leafId !== undefined ? leafId : resolveLeafId(entries);
  const byId = new Map(entries.map(entry => [entry.id, entry]));

  let cursorId = resolvedLeaf !== null && byId.has(resolvedLeaf) ? resolvedLeaf : resolveLeafId(entries);
  const path: SessionEntry[] = [];

  while (cursorId) {
    const entry = byId.get(cursorId);

    if (!entry) {
      break;
    }

    path.push(entry);
    cursorId = entry.parentId;
  }

  return path.toReversed();
}

/** 完整回放：路径 + 上下文消息（compaction 生效后）。 */
export function buildReplay(file: ParsedSessionFile): ReplayResult {
  const path = getPathToRoot(file);

  return {
    path,
    leafId: resolveLeafId(file.entries),
    effectiveCompaction: findEffectiveCompaction(path)
  };
}

/**
 * 构建模型上下文消息序列。
 *
 * 路径上最后一条 compaction 生效：firstKeptEntryId 之前的 message 折叠为一条
 * user 角色摘要消息；其余 message 原样输出。非 message entry 不进上下文。
 */
export function buildContextMessages(file: ParsedSessionFile): SessionMessage[] {
  const path = getPathToRoot(file);
  const compaction = findEffectiveCompaction(path);

  if (!compaction) {
    return path.filter(isMessageEntry).map(entry => entry.message);
  }

  const keptIndex = path.findIndex(entry => entry.id === compaction.firstKeptEntryId);
  // 悬空引用（跨分支/截断）时退化为折叠 compaction 之前的全部 message。
  const boundary = keptIndex >= 0 ? keptIndex : path.indexOf(compaction);

  const messages: SessionMessage[] = [];

  if (compaction.summary.trim()) {
    messages.push({ role: 'user', content: compaction.summary });
  }

  for (const [index, entry] of path.entries()) {
    if (!isMessageEntry(entry)) {
      continue;
    }

    if (index < boundary) {
      continue;
    }

    messages.push(entry.message);
  }

  return messages;
}

function findEffectiveCompaction(path: SessionEntry[]): Extract<SessionEntry, { type: 'compaction' }> | undefined {
  let effective: Extract<SessionEntry, { type: 'compaction' }> | undefined;

  for (const entry of path) {
    if (entry.type === 'compaction') {
      effective = entry;
    }
  }

  return effective;
}

function isMessageEntry(entry: SessionEntry): entry is Extract<SessionEntry, { type: 'message' }> {
  return entry.type === 'message';
}
