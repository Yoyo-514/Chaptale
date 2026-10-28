import { randomUUID } from 'node:crypto';

import { commitSnapshot } from '../content/commit.ts';
import { readEntrySnapshot } from '../content/mutations.ts';
import type {
  CreationAgentCommand,
  CreationAgentCommands,
  CreationAgentContext,
  AgentWriteCommand,
  AgentWriteResult,
  Entry,
  EntrySnapshot,
  PendingChange
} from '../contracts.ts';
import { assertNotTrashed, RevisionConflictError } from '../errors.ts';
import type { CreationRepository } from '../repository.ts';
import type { DeliveryService } from '../review/delivery.ts';
import { overlayEntries } from '../review/overlay.ts';
import { advanceChange } from '../review/pending-change.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';
import type { TrashService } from '../trash.ts';
import { proposeEntry } from './proposal.ts';

type AgentValue = Extract<CreationAgentCommands[keyof CreationAgentCommands]['output'], { ok: true }>['value'];

/** Agent 用例的身份与模式边界；候选和正式提交使用相同的内容领域规则。 */
export class CreationAgentService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;
  private readonly delivery: DeliveryService;
  private readonly trash: TrashService;
  constructor(
    repository: CreationRepository,
    creation: CreationService,
    review: ReviewService,
    delivery: DeliveryService,
    trash: TrashService
  ) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
    this.delivery = delivery;
    this.trash = trash;
  }

  execute(context: CreationAgentContext, command: CreationAgentCommand): AgentValue {
    switch (command.method) {
      case 'listWorks':
        return this.creation.listWorks();
      case 'listEntries':
        return context.mode === 'review'
          ? this.entries(command.input.workId, context.sessionId)
          : this.creation.listEntries(command.input.workId);
      case 'readDocument': {
        const { workId, documentId } = command.input;
        if (context.mode !== 'review') return this.creation.readDocument(workId, documentId);
        const change = this.review.list(workId, context.sessionId).find(item => item.entryId === documentId);
        if (!change) return this.creation.readDocument(workId, documentId);
        const snapshot = this.review.read(change.id).candidate;
        if (snapshot.kind !== 'document') throw new Error('文稿或资料不存在');
        return {
          ...snapshot,
          kind: 'document' as const,
          format: snapshot.format as 'txt' | 'markdown',
          content: snapshot.content!
        };
      }
      case 'searchDocuments': {
        if (context.mode !== 'review') return this.creation.searchDocuments(command.input);
        const { workId } = command.input;
        const changes = this.review.list(workId, context.sessionId);
        const candidates = changes
          .filter(change => !change.deleted)
          .map(change => this.review.read(change.id).candidate);
        const visible = new Set(this.entries(workId, context.sessionId).map(entry => entry.id));
        const hidden = this.creation
          .listEntries(workId)
          .filter(entry => !visible.has(entry.id))
          .map(entry => entry.id);
        return this.repository.searchDocuments(command.input, candidates, hidden);
      }
      case 'deleteEntry':
        return this.remove(context, command);
      default:
        return this.write(context, command);
    }
  }

  private entries(workId: string, sessionId: string): Entry[] {
    const views = this.review.list(workId, sessionId).map(change => this.review.read(change.id));
    return overlayEntries(this.creation.listEntries(workId), views);
  }

  /** 删除只移入作品回收站：直接修改模式立即提交，审阅模式生成整篇决定的删除候选。 */
  private remove(context: CreationAgentContext, command: DeleteCommand): AgentWriteResult {
    if (context.mode === 'discuss') throw new Error('当前为讨论模式，作品只读');
    const { workId, commandId, entryId, expectedRevisionId } = command.input;
    const { sessionId } = context;
    if (context.mode === 'direct') {
      const receipt = this.repository.readWorkReceipt<Entry[]>(workId, commandId, ['trashEntries', workId, [entryId]]);
      if (receipt) return { kind: 'trashed', entries: receipt };
      if ((this.delivery.current(sessionId)?.pendingCount ?? 0) > 0)
        throw new Error('请先处理当前这组待接受修改，再切换直接修改');
      this.delivery.assertWritable(sessionId, workId, entryId);
      const current = this.existingEntry(workId, entryId);
      if (current.revisionId !== expectedRevisionId)
        throw new RevisionConflictError(expectedRevisionId, current.revisionId);
      return { kind: 'trashed', entries: this.trash.trash({ commandId, workId, entryIds: [entryId] }) };
    }
    const parameters = ['agent', sessionId, command] as const;
    const change = this.creation.commit(null, commandId, parameters, { kind: 'review' }, () => {
      this.delivery.assertWritable(sessionId, workId, entryId);
      const changes = this.review.list(workId, sessionId);
      const existing = changes.find(item => item.entryId === entryId);
      if (existing?.authorEdited) throw new Error('作者正在审阅或手改此候选，请等待作者处理后再修改');
      if (existing?.base === null) {
        if (existing.candidate.revisionId !== expectedRevisionId)
          throw new RevisionConflictError(expectedRevisionId, existing.candidate.revisionId);
        return this.review.withdraw(existing);
      }
      if (existing?.deleted) throw new Error('该条目已有待接受的删除');
      const current = this.existingEntry(workId, entryId);
      const actual = existing?.candidate.revisionId ?? current.revisionId;
      if (actual !== expectedRevisionId) throw new RevisionConflictError(expectedRevisionId, actual);
      // 会话目录中位于被删条目之下的本会话修改并入删除候选。
      const entries = this.entries(workId, sessionId);
      const removed = new Set([entryId]);
      for (let size = 0; size !== removed.size;) {
        size = removed.size;
        for (const entry of entries) if (entry.parentId !== null && removed.has(entry.parentId)) removed.add(entry.id);
      }
      const covered = changes.filter(item => item.id !== existing?.id && removed.has(item.entryId));
      for (const item of covered) this.repository.putPendingChange(advanceChange(item, { status: 'covered' }));
      const version = randomUUID();
      const next: PendingChange = {
        id: existing?.id ?? randomUUID(),
        workId,
        sessionId,
        entryId,
        version,
        order: existing?.order ?? Math.max(0, ...changes.map(item => item.order)) + 1,
        base: current,
        candidate: { ...current, revisionId: version },
        conflicts: [],
        authorEdited: false,
        status: 'pending',
        deleted: true,
        covers: covered.map(item => item.id),
        updatedAt: Date.now()
      };
      this.repository.putPendingChange(next);
      this.delivery.attach(next);
      return next;
    });
    return change.deleted ? { kind: 'pending', change } : { kind: 'withdrawn', change };
  }

  private existingEntry(workId: string, entryId: string): EntrySnapshot {
    if (!this.repository.hasWork(workId)) throw new Error('作品不存在');
    assertNotTrashed(this.repository, workId, entryId);
    const current = readEntrySnapshot(this.repository, workId, entryId);
    if (!current) throw new Error('条目不存在');
    return current;
  }

  private write(context: CreationAgentContext, command: WriteCommand): AgentWriteResult {
    if (context.mode === 'discuss') throw new Error('当前为讨论模式，作品只读');
    const { workId, commandId } = command.input;
    const parameters = ['agent', context.sessionId, command] as const;
    if (context.mode === 'direct') {
      const receipt = this.repository.readWorkReceipt<Entry>(workId, commandId, parameters);
      if (receipt) return { kind: 'saved', entry: receipt };
      if ((this.delivery.current(context.sessionId)?.pendingCount ?? 0) > 0)
        throw new Error('请先处理当前这组待接受修改，再切换直接修改');
      this.delivery.assertWritable(context.sessionId, workId, targetId(command));
      const { base, candidate } = this.propose(context, command);
      return {
        kind: 'saved',
        entry: commitSnapshot(this.repository, this.creation.commit.bind(this.creation), {
          workId,
          commandId,
          parameters,
          base,
          candidate,
          source: 'agent'
        })
      };
    }
    const pending = this.creation.commit(null, commandId, parameters, { kind: 'review' }, () => {
      this.delivery.assertWritable(context.sessionId, workId, targetId(command));
      const { base, candidate, existing } = this.propose(context, command);
      const order =
        existing && command.method !== 'moveEntry'
          ? existing.order
          : Math.max(0, ...this.review.list(workId, context.sessionId).map(item => item.order)) + 1;
      const change: PendingChange = {
        id: existing?.id ?? randomUUID(),
        workId,
        sessionId: context.sessionId,
        entryId: candidate.id,
        version: candidate.revisionId,
        order,
        base,
        candidate,
        conflicts: [],
        authorEdited: false,
        status: 'pending',
        updatedAt: Date.now()
      };
      this.repository.putPendingChange(change);
      this.delivery.attach(change);
      return change;
    });
    return { kind: 'pending', change: pending };
  }

  private propose(context: CreationAgentContext, command: WriteCommand) {
    const { sessionId, mode } = context;
    const { workId } = command.input;
    if (!this.repository.hasWork(workId)) throw new Error('作品不存在');
    const entryId = targetId(command);
    const existing =
      entryId === null || mode !== 'review'
        ? undefined
        : this.review.list(workId, sessionId).find(change => change.entryId === entryId);
    if (entryId !== null) assertNotTrashed(this.repository, workId, entryId);
    const current = entryId === null ? null : readEntrySnapshot(this.repository, workId, entryId);
    const entries = mode === 'review' ? this.entries(workId, sessionId) : this.creation.listEntries(workId);
    return { ...proposeEntry(command, entries, current, existing), existing };
  }
}

type DeleteCommand = Extract<AgentWriteCommand, { method: 'deleteEntry' }>;
type WriteCommand = Exclude<AgentWriteCommand, { method: 'deleteEntry' }>;

function targetId(command: WriteCommand): string | null {
  if (command.method === 'createEntry') return null;
  return 'documentId' in command.input ? command.input.documentId : command.input.entryId;
}
