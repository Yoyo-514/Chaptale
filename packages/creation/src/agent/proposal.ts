import { randomUUID } from 'node:crypto';

import { assertEntryParent, initialAttributes } from '../content/entries.ts';
import type { Entry, EntrySnapshot } from '../contracts/content.ts';
import type { AgentWriteCommand, PendingChange } from '../contracts/review.ts';
import { EntryLocationConflictError, RevisionConflictError } from '../errors.ts';
import { mergeCandidate } from '../review/merge.ts';
import { countDocumentWords } from '../text.ts';

/** 把 Agent 指令转成候选快照；计算仅依赖当前正式稿与本会话视图。 */
export function proposeEntry(
  command: Exclude<AgentWriteCommand, { method: 'deleteEntry' }>,
  entries: Entry[],
  current: EntrySnapshot | null,
  existing?: PendingChange
): { base: EntrySnapshot | null; candidate: EntrySnapshot } {
  if (existing?.authorEdited) throw new Error('作者正在审阅或手改此候选，请等待作者处理后再修改');
  const view = existing ? mergeCandidate(existing, current) : undefined;
  if (view?.conflicts.length) throw new Error('候选与正式内容存在冲突，请等待作者处理');
  let candidate: EntrySnapshot;
  if (command.method === 'createEntry') {
    const input = command.input;
    const now = Date.now();
    candidate = {
      id: randomUUID(),
      parentId: input.parentId,
      section: input.section,
      kind: input.kind,
      title: input.title,
      position:
        Math.max(
          -1,
          ...entries
            .filter(entry => entry.parentId === input.parentId && entry.section === input.section)
            .map(entry => entry.position)
        ) + 1,
      format: input.kind === 'document' ? input.format : null,
      fileName: null,
      content: input.kind === 'document' ? input.content : null,
      attributes: initialAttributes(input),
      wordCount: 0,
      revisionId: randomUUID(),
      createdAt: now,
      updatedAt: now
    };
  } else {
    const snapshot = view?.candidate ?? current;
    if (!snapshot) throw new Error('文稿或目录不存在');
    candidate = { ...snapshot };
    if ('expectedRevisionId' in command.input && snapshot.revisionId !== command.input.expectedRevisionId)
      throw new RevisionConflictError(command.input.expectedRevisionId, snapshot.revisionId);
    if (command.method === 'writeDocument' || command.method === 'writeContent') {
      if (snapshot.kind !== 'document') throw new Error('文稿或资料不存在');
      candidate.content = command.input.content;
      if (command.method === 'writeDocument') {
        candidate.title = command.input.title;
        candidate.format = command.input.format;
      }
    } else if (command.method === 'editDocument') {
      if (snapshot.content === null) throw new Error('文稿或资料不存在');
      const { oldText, newText } = command.input;
      const at = snapshot.content.indexOf(oldText);
      if (at < 0 || snapshot.content.indexOf(oldText, at + 1) >= 0)
        throw new Error('待替换原文必须在当前正文中唯一匹配');
      candidate.content = snapshot.content.slice(0, at) + newText + snapshot.content.slice(at + oldText.length);
    } else if (command.method === 'renameEntry') candidate.title = command.input.title;
    else {
      const input = command.input;
      const visible = entries.find(entry => entry.id === snapshot.id)!;
      if (visible.parentId !== input.expectedParentId || visible.position !== input.expectedPosition)
        throw new EntryLocationConflictError(visible.parentId, visible.position);
      if (input.beforeEntryId === snapshot.id && input.parentId !== visible.parentId)
        throw new Error('排序目标不存在或不属于目标目录');
      if (input.beforeEntryId !== snapshot.id) {
        // oxlint-disable-next-line unicorn/no-array-sort
        const siblings = entries
          .filter(
            entry => entry.section === snapshot.section && entry.parentId === input.parentId && entry.id !== snapshot.id
          )
          .sort((a, b) => a.position - b.position);
        const position =
          input.beforeEntryId === null
            ? siblings.length
            : siblings.findIndex(entry => entry.id === input.beforeEntryId);
        if (position < 0) throw new Error('排序目标不存在或不属于目标目录');
        candidate.parentId = input.parentId;
        candidate.position = position;
      }
    }
  }
  assertEntryParent(entries, candidate);
  candidate.revisionId = randomUUID();
  candidate.updatedAt = Date.now();
  candidate.wordCount = candidate.content === null ? 0 : countDocumentWords(candidate.content);
  return { base: existing?.base === null ? null : current, candidate };
}
