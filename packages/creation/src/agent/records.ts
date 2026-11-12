import { randomUUID } from 'node:crypto';

import type {
  AgentWriteCommand,
  AgentWriteResult,
  CreationAgentCommands,
  CreationAgentContext,
  EntryReviewView,
  RecordChange,
  RecordFields,
  RecordSnapshot,
  StoryRecord
} from '../contracts.ts';
import { groupRecords } from '../contracts.ts';
import { RevisionConflictError } from '../errors.ts';
import { applyRecordSnapshot, assertRecord, normalizeRecord } from '../records/commit.ts';
import { sourceChecker } from '../records/sources.ts';
import type { CreationRepository } from '../repository.ts';
import { overlayEntries } from '../review/entry/overlay.ts';
import { mergeRecord, recordSnapshot } from '../review/record/merge.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';

type RecordCommand = Extract<AgentWriteCommand, { method: 'createRecord' | 'updateRecord' | 'removeRecord' }>;

/** Agent 读写事件：讨论模式只读，直接修改模式立即提交，审阅模式生成本会话候选。 */
export class AgentRecordService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;

  constructor(repository: CreationRepository, creation: CreationService, review: ReviewService) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
  }

  /** 审阅模式下候选覆盖正式事件，待移除的事件隐藏；候选的 revisionId 为候选版本。 */
  list(
    context: CreationAgentContext,
    input: CreationAgentCommands['listRecords']['input']
  ): (StoryRecord & { sourceChanged: boolean; pending: boolean })[] {
    const { workId, resourceId, sourceId, asOf } = input;
    const work = this.repository.work(workId);
    let records = work.listRecords();
    let entries = work.listEntries();
    const pending = new Set<string>();
    if (context.mode === 'review') {
      const changes = this.review.list(workId, context.sessionId);
      entries = overlayEntries(
        entries,
        changes
          .filter(change => change.target === 'entry')
          .map(change => this.review.read(change.id) as EntryReviewView)
      );
      const byId = new Map(records.map(record => [record.id, record]));
      for (const change of changes) {
        if (change.target !== 'record') continue;
        if (change.deleted) {
          byId.delete(change.targetId);
          continue;
        }
        const current = byId.get(change.targetId);
        pending.add(change.targetId);
        byId.set(change.targetId, candidateRecord(change, current, [...byId.values()]));
      }
      records = [...byId.values()];
    }
    if (asOf !== null && !entries.some(entry => entry.id === asOf && entry.section === 'manuscript'))
      throw new Error('查看进度的章节不存在');
    const changed = sourceChecker(work, new Map(entries.map(entry => [entry.id, entry.revisionId])));
    return groupRecords(records, entries, asOf)
      .flatMap(group => group.records)
      .filter(record => resourceId === null || record.resourceIds.includes(resourceId))
      .filter(record => sourceId === null || (record.source.kind === 'chapter' && record.source.chapterId === sourceId))
      .map(record => ({ ...record, sourceChanged: changed(record.source), pending: pending.has(record.id) }));
  }

  write(context: CreationAgentContext, command: RecordCommand): AgentWriteResult {
    if (context.mode === 'discuss') throw new Error('当前为讨论模式，作品只读');
    const { workId, commandId } = command.input;
    const parameters = ['agent', context.sessionId, command] as const;
    if (context.mode === 'direct') {
      const removed = command.method === 'removeRecord';
      const receipt = this.repository.work(workId).readReceipt<StoryRecord>(commandId, parameters);
      if (receipt) return { kind: 'record', record: receipt, removed };

      const record = this.creation.commit(workId, commandId, parameters, { kind: 'record', removed }, () =>
        this.commitDirect(command)
      );
      if (removed) this.review.rejectTrashed(workId);
      return { kind: 'record', record, removed };
    }
    const change = this.creation.commit(null, commandId, parameters, { kind: 'review' }, () => {
      return this.propose(context, command);
    });
    return change.status === 'pending' ? { kind: 'pending', change } : { kind: 'withdrawn', change };
  }

  private commitDirect(command: RecordCommand): StoryRecord {
    const work = this.repository.work(command.input.workId);
    if (command.method === 'createRecord')
      return applyRecordSnapshot(work, {
        base: null,
        candidate: { id: randomUUID(), ...fields(command.input) },
        source: 'agent'
      });
    const current = this.formal(command.input.workId, command.input.recordId);
    if (current.revisionId !== command.input.expectedRevisionId)
      throw new RevisionConflictError(command.input.expectedRevisionId, current.revisionId);
    if (command.method === 'removeRecord') {
      work.trashRecord(current.id, randomUUID(), Date.now());
      return current;
    }
    return applyRecordSnapshot(work, {
      base: current,
      candidate: { id: current.id, ...fields(command.input) },
      source: 'agent'
    });
  }

  /** 生成或演进本会话候选；撤回本会话新建的事件时返回已拒绝的候选。 */
  private propose(context: CreationAgentContext, command: RecordCommand): RecordChange {
    const { workId } = command.input;
    const { sessionId } = context;
    const work = this.repository.work(workId);
    const changes = this.review.list(workId, sessionId);
    const order = Math.max(0, ...changes.map(item => item.order)) + 1;
    const entries = overlayEntries(
      work.listEntries(),
      changes.filter(change => change.target === 'entry').map(change => this.review.read(change.id) as EntryReviewView)
    );
    const basis = command.input.basis.trim();
    if (command.method === 'createRecord') {
      const candidate: RecordSnapshot = { id: randomUUID(), ...normalizeRecord(fields(command.input)) };
      assertRecord(work, candidate, null, entries);
      return this.put(newChange(workId, sessionId, order, null, candidate, basis));
    }
    const { recordId, expectedRevisionId } = command.input;
    const existing = changes.find(
      (change): change is RecordChange => change.target === 'record' && change.targetId === recordId
    );
    if (existing?.deleted) throw new Error('该事件已有待接受的移除');
    const current = work.getRecord(recordId) ?? null;
    if (!existing && !current) throw new Error(work.isRecordTrashed(recordId) ? '事件在回收站中' : '事件不存在');
    const actual = existing?.version ?? current!.revisionId;
    if (actual !== expectedRevisionId) throw new RevisionConflictError(expectedRevisionId, actual);
    if (existing && mergeRecord(existing, current).conflicts.length)
      throw new Error('候选与正式内容存在冲突，请等待作者处理');
    if (command.method === 'removeRecord') {
      if (existing?.base === null) return this.review.withdraw(existing) as RecordChange;
      const base = recordSnapshot(current!);
      return this.put({
        ...newChange(workId, sessionId, existing?.order ?? order, base, base, basis),
        id: existing?.id ?? randomUUID(),
        authorEdited: existing !== undefined && existing.authorEdited,
        deleted: true
      });
    }
    const previous = existing?.candidate ?? recordSnapshot(current!);
    const candidate: RecordSnapshot = { id: recordId, ...normalizeRecord(fields(command.input)) };
    assertRecord(work, candidate, previous, entries);
    const base = existing ? existing.base : recordSnapshot(current!);
    return this.put({
      ...newChange(workId, sessionId, existing?.order ?? order, base, candidate, basis),
      id: existing?.id ?? randomUUID(),
      authorEdited: existing !== undefined && existing.authorEdited
    });
  }

  private put(change: RecordChange): RecordChange {
    this.repository.library.putPendingChange(change);

    return change;
  }

  private formal(workId: string, recordId: string): StoryRecord {
    const work = this.repository.work(workId);
    const record = work.getRecord(recordId);
    if (!record) throw new Error(work.isRecordTrashed(recordId) ? '事件在回收站中' : '事件不存在');
    return record;
  }
}

function fields(input: RecordFields): RecordFields {
  const { resourceIds, text, source, placement, storyTime } = input;
  return { resourceIds, text, source, placement, storyTime };
}

function newChange(
  workId: string,
  sessionId: string,
  order: number,
  base: RecordSnapshot | null,
  candidate: RecordSnapshot,
  basis: string
): RecordChange {
  return {
    target: 'record',
    id: randomUUID(),
    workId,
    sessionId,
    targetId: candidate.id,
    version: randomUUID(),
    order,
    base,
    candidate,
    basis,
    conflicts: [],
    authorEdited: false,
    status: 'pending',
    updatedAt: Date.now()
  };
}

/** 候选在会话视图中的样子：沿用正式顺序，新事件或改了发生位置的排到该位置末尾。 */
function candidateRecord(change: RecordChange, current: StoryRecord | undefined, records: StoryRecord[]): StoryRecord {
  const moved = !current || JSON.stringify(current.placement) !== JSON.stringify(change.candidate.placement);
  const position = moved
    ? Math.max(
        -1,
        ...records
          .filter(record => JSON.stringify(record.placement) === JSON.stringify(change.candidate.placement))
          .map(record => record.position)
      ) + 1
    : current.position;
  const now = change.updatedAt;
  return {
    ...change.candidate,
    position,
    revisionId: change.version,
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  };
}
