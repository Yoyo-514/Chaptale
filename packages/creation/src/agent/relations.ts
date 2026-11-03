import { randomUUID } from 'node:crypto';

import type {
  AgentRelationUpdate,
  AgentWriteCommand,
  AgentWriteResult,
  CreationAgentCommands,
  CreationAgentContext,
  EntryReviewView,
  RelationChange,
  RelationInput,
  RelationSnapshot,
  StoryRelation
} from '../contracts.ts';
import { relationState, relationTypes } from '../contracts.ts';
import { RevisionConflictError } from '../errors.ts';
import { sourceChecker } from '../records/sources.ts';
import { applyRelationSnapshot, assertRelation, normalizeRelation, relationSnapshot } from '../relations/commit.ts';
import type { CreationRepository } from '../repository.ts';
import type { DeliveryService } from '../review/delivery.ts';
import { overlayEntries } from '../review/entry/overlay.ts';
import { mergeRelation, relationSnapshot as snapshotOf } from '../review/relation/merge.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';

type RelationCommand = Extract<AgentWriteCommand, { method: 'createRelation' | 'updateRelation' | 'removeRelation' }>;
type Listed = Extract<CreationAgentCommands['listRelations']['output'], { ok: true }>['value'];

/** Agent 读写关系：讨论模式只读，直接修改模式立即提交，审阅模式生成本会话候选。 */
export class AgentRelationService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;
  private readonly delivery: DeliveryService;

  constructor(
    repository: CreationRepository,
    creation: CreationService,
    review: ReviewService,
    delivery: DeliveryService
  ) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
    this.delivery = delivery;
  }

  list(context: CreationAgentContext, input: CreationAgentCommands['listRelations']['input']): Listed {
    const { workId, resourceId, asOf } = input;
    const { work, entries, relations, changes } = this.visible(context, workId);
    const changed = sourceChecker(work, new Map(entries.map(entry => [entry.id, entry.revisionId])));
    const pending = new Set(changes.filter(change => change.target === 'relation').map(change => change.targetId));
    if (asOf !== null && !entries.some(entry => entry.id === asOf && entry.section === 'manuscript'))
      throw new Error('查看进度的章节不存在');
    return {
      relations: relations
        .filter(relation => resourceId === null || relation.resourceIds.includes(resourceId))
        .map(relation => ({
          ...relation,
          milestones: relation.milestones.map(milestone => ({
            ...milestone,
            sourceChanged: changed(milestone.source)
          })),
          state: relationState(relation, entries, asOf),
          pending: pending.has(relation.id)
        })),
      types: relationTypes(relations)
    };
  }

  write(context: CreationAgentContext, command: RelationCommand): AgentWriteResult {
    if (context.mode === 'discuss') throw new Error('当前为讨论模式，作品只读');
    const { workId, commandId } = command.input;
    const parameters = ['agent', context.sessionId, command] as const;
    const targetId = command.method === 'createRelation' ? null : command.input.relationId;
    if (context.mode === 'direct') {
      const removed = command.method === 'removeRelation';
      const receipt = this.repository.work(workId).readReceipt<StoryRelation>(commandId, parameters);
      if (receipt) return { kind: 'relation', relation: receipt, removed };
      if ((this.delivery.current(context.sessionId)?.pendingCount ?? 0) > 0)
        throw new Error('请先处理当前这组待接受修改，再切换直接修改');
      this.delivery.assertWritable(context.sessionId, workId, targetId);
      const relation = this.creation.commit(workId, commandId, parameters, { kind: 'relation', removed }, () =>
        this.commitDirect(command)
      );
      if (removed) this.review.rejectTrashed(workId);
      return { kind: 'relation', relation, removed };
    }
    const change = this.creation.commit(null, commandId, parameters, { kind: 'review' }, () => {
      this.delivery.assertWritable(context.sessionId, workId, targetId);
      return this.propose(context, command);
    });
    return change.status === 'pending' ? { kind: 'pending', change } : { kind: 'withdrawn', change };
  }

  /** 审阅模式下候选覆盖正式关系与目录，待移除的关系隐藏；候选的 revisionId 为候选版本。 */
  private visible(context: CreationAgentContext, workId: string) {
    const work = this.repository.work(workId);
    let relations = work.listRelations();
    let entries = work.listEntries();
    if (context.mode !== 'review') return { work, entries, relations, changes: [] };
    const changes = this.review.list(workId, context.sessionId);
    entries = overlayEntries(
      entries,
      changes.filter(change => change.target === 'entry').map(change => this.review.read(change.id) as EntryReviewView)
    );
    const byId = new Map(relations.map(relation => [relation.id, relation]));
    for (const change of changes) {
      if (change.target !== 'relation') continue;
      if (change.deleted) byId.delete(change.targetId);
      else {
        const current = byId.get(change.targetId);
        byId.set(change.targetId, {
          ...change.candidate,
          revisionId: change.version,
          createdAt: current?.createdAt ?? change.updatedAt,
          updatedAt: change.updatedAt
        });
      }
    }
    relations = [...byId.values()];
    return { work, entries, relations, changes };
  }

  private commitDirect(command: RelationCommand): StoryRelation {
    const work = this.repository.work(command.input.workId);
    if (command.method === 'createRelation')
      return applyRelationSnapshot(work, {
        base: null,
        candidate: relationSnapshot(randomUUID(), fields(command.input), null),
        source: 'agent'
      });
    const current = work.getRelation(command.input.relationId);
    if (!current) throw new Error(work.isRelationTrashed(command.input.relationId) ? '关系在回收站中' : '关系不存在');
    if (current.revisionId !== command.input.expectedRevisionId)
      throw new RevisionConflictError(command.input.expectedRevisionId, current.revisionId);
    if (command.method === 'removeRelation') {
      work.trashRelation(current.id, randomUUID(), Date.now());
      return current;
    }
    return applyRelationSnapshot(work, {
      base: current,
      candidate: patchRelation(snapshotOf(current), command.input),
      source: 'agent'
    });
  }

  /** 生成或演进本会话候选；撤回本会话新建的关系时返回已拒绝的候选。 */
  private propose(context: CreationAgentContext, command: RelationCommand): RelationChange {
    const { workId } = command.input;
    const { sessionId } = context;
    const { work, entries, relations, changes } = this.visible(context, workId);
    const order = Math.max(0, ...changes.map(item => item.order)) + 1;
    const basis = command.input.basis.trim();
    if (command.method === 'createRelation') {
      const candidate = relationSnapshot(randomUUID(), fields(command.input), null);
      assertRelation(work, candidate, null, entries, relations);
      return this.put(newChange(workId, sessionId, order, null, candidate, basis));
    }
    const { relationId, expectedRevisionId } = command.input;
    const existing = changes.find(
      (change): change is RelationChange => change.target === 'relation' && change.targetId === relationId
    );
    if (existing?.authorEdited) throw new Error('作者正在审阅或手改此候选，请等待作者处理后再修改');
    if (existing?.deleted) throw new Error('该关系已有待接受的移除');
    const current = work.getRelation(relationId) ?? null;
    if (!existing && !current) throw new Error(work.isRelationTrashed(relationId) ? '关系在回收站中' : '关系不存在');
    const actual = existing?.version ?? current!.revisionId;
    if (actual !== expectedRevisionId) throw new RevisionConflictError(expectedRevisionId, actual);
    if (existing && mergeRelation(existing, current).conflicts.length)
      throw new Error('候选与正式内容存在冲突，请等待作者处理');
    const id = existing?.id ?? randomUUID();
    const base = existing ? existing.base : snapshotOf(current!);
    if (command.method === 'removeRelation') {
      if (existing?.base === null) return this.review.withdraw(existing) as RelationChange;
      const formal = snapshotOf(current!);
      return this.put({
        ...newChange(workId, sessionId, existing?.order ?? order, formal, formal, basis),
        id,
        deleted: true
      });
    }
    const previous = existing?.candidate ?? snapshotOf(current!);
    const candidate = patchRelation(previous, command.input);
    assertRelation(work, candidate, previous, entries, relations);
    return this.put({ ...newChange(workId, sessionId, existing?.order ?? order, base, candidate, basis), id });
  }

  private put(change: RelationChange): RelationChange {
    this.repository.library.putPendingChange(change);
    this.delivery.attach(change);
    return change;
  }
}

function fields(input: RelationInput): RelationInput {
  const { resourceIds, type, directed, titles, milestones } = input;
  return { resourceIds, type, directed, titles, milestones };
}

/** 在 previous 上应用改动：省略的关系字段保持不变，新增的建立／结束排到末尾，修改的留在原处。 */
function patchRelation(previous: RelationSnapshot, input: AgentRelationUpdate): RelationSnapshot {
  const milestones = [...previous.milestones];
  for (const patch of input.milestones) {
    if ('remove' in patch) {
      const index = milestones.findIndex(item => item.id === patch.id);
      if (index === -1) throw new Error('要移除的建立或结束不存在');
      milestones.splice(index, 1);
      continue;
    }
    const { id, kind, source, placement, storyTime } = patch;
    if (id === null) {
      milestones.push({ id: randomUUID(), kind, source, placement, storyTime });
      continue;
    }
    const index = milestones.findIndex(item => item.id === id);
    if (index === -1) throw new Error('要修改的建立或结束不存在');
    milestones[index] = { id, kind, source, placement, storyTime };
  }
  return normalizeRelation({
    id: previous.id,
    resourceIds: input.resourceIds ?? previous.resourceIds,
    type: input.type ?? previous.type,
    directed: input.directed ?? previous.directed,
    titles: input.titles ?? previous.titles,
    milestones
  });
}

function newChange(
  workId: string,
  sessionId: string,
  order: number,
  base: RelationSnapshot | null,
  candidate: RelationSnapshot,
  basis: string
): RelationChange {
  return {
    target: 'relation',
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
