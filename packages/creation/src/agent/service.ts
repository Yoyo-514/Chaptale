import { randomUUID } from 'node:crypto';

import { readEntrySnapshot } from '../content/mutations.ts';
import type { TrashService } from '../content/trash.ts';
import type {
  CreationAgentCommand,
  CreationAgentCommands,
  CreationAgentContext,
  AgentWriteCommand,
  AgentWriteResult,
  Entry,
  EntryChange,
  EntryReviewView,
  EntrySnapshot
} from '../contracts.ts';
import { assertNotTrashed, RevisionConflictError } from '../errors.ts';
import type { CreationRepository } from '../repository.ts';
import { overlayEntries } from '../review/entry/overlay.ts';
import { advanceChange } from '../review/pending-change.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';
import { illustrationIds } from '../text.ts';
import { proposeEntry, type EntryWriteCommand } from './proposal.ts';
import type { AgentRecordService } from './records.ts';
import type { AgentRelationService } from './relations.ts';

type AgentValue = Extract<CreationAgentCommands[keyof CreationAgentCommands]['output'], { ok: true }>['value'];

/** Agent 用例的身份与模式边界；候选和正式提交使用相同的内容领域规则。 */
export class CreationAgentService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;
  private readonly trash: TrashService;
  private readonly records: AgentRecordService;
  private readonly relations: AgentRelationService;
  constructor(
    repository: CreationRepository,
    creation: CreationService,
    review: ReviewService,
    trash: TrashService,
    records: AgentRecordService,
    relations: AgentRelationService
  ) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
    this.trash = trash;
    this.records = records;
    this.relations = relations;
  }

  execute(context: CreationAgentContext, command: CreationAgentCommand): AgentValue {
    // 作品库回收站中的作品对 Agent 不可见。
    if (
      'workId' in command.input &&
      command.input.workId !== null &&
      !this.repository.library.hasWork(command.input.workId)
    )
      throw new Error('作品不存在');
    switch (command.method) {
      case 'listWorks':
        return this.creation.listWorks();
      case 'readWritingGuidelines':
        return this.creation.readWritingGuidelines(command.input.workId);
      case 'listEntries':
        return context.mode === 'review'
          ? this.entries(command.input.workId, context.sessionId)
          : this.creation.listEntries(command.input.workId);
      case 'readDocument': {
        const { workId, documentId } = command.input;
        const change =
          context.mode === 'review'
            ? this.review.list(workId, context.sessionId).find(item => item.targetId === documentId)
            : undefined;
        if (!change || change.target !== 'entry')
          return { ...this.creation.readDocument(workId, documentId), pending: false };
        const snapshot = (this.review.read(change.id) as EntryReviewView).candidate;
        if (snapshot.kind !== 'document') throw new Error('文稿或资料不存在');
        return {
          ...snapshot,
          kind: 'document' as const,
          format: snapshot.format as 'txt' | 'markdown',
          content: snapshot.content!,
          pending: true
        };
      }
      case 'searchDocuments': {
        if (context.mode !== 'review') return this.creation.searchDocuments(command.input);
        const { workId } = command.input;
        const changes = this.review.list(workId, context.sessionId);
        const candidates = changes
          .filter(change => change.target === 'entry' && !change.deleted)
          .map(change => (this.review.read(change.id) as EntryReviewView).candidate);
        const visible = new Set(this.entries(workId, context.sessionId).map(entry => entry.id));
        const hidden = this.creation
          .listEntries(workId)
          .filter(entry => !visible.has(entry.id))
          .map(entry => entry.id);
        return this.repository.work(command.input.workId).searchDocuments(command.input, candidates, hidden);
      }
      case 'listRecords':
        return this.records.list(context, command.input);
      case 'createRecord':
      case 'updateRecord':
      case 'removeRecord':
        return this.records.write(context, command);
      case 'listRelations':
        return this.relations.list(context, command.input);
      case 'createRelation':
      case 'updateRelation':
      case 'removeRelation':
        return this.relations.write(context, command);
      case 'deleteEntry':
        return this.remove(context, command);
      default:
        return this.write(context, command);
    }
  }

  private entries(workId: string, sessionId: string): Entry[] {
    const views = this.review
      .list(workId, sessionId)
      .filter(change => change.target === 'entry')
      .map(change => this.review.read(change.id) as EntryReviewView);
    return overlayEntries(this.creation.listEntries(workId), views);
  }

  /** 删除只移入作品回收站：直接修改模式立即提交，审阅模式生成整篇决定的删除候选。 */
  private remove(context: CreationAgentContext, command: DeleteCommand): AgentWriteResult {
    if (context.mode === 'discuss') throw new Error('当前为讨论模式，作品只读');
    const { workId, commandId, entryId, expectedRevisionId } = command.input;
    const { sessionId } = context;
    if (context.mode === 'direct') {
      const receipt = this.repository.work(workId).readReceipt<Entry[]>(commandId, ['trashEntries', workId, [entryId]]);
      if (receipt) return { kind: 'trashed', entries: receipt };

      const current = this.existingEntry(workId, entryId);
      if (current.revisionId !== expectedRevisionId)
        throw new RevisionConflictError(expectedRevisionId, current.revisionId);
      return { kind: 'trashed', entries: this.trash.trash({ commandId, workId, entryIds: [entryId] }) };
    }
    const parameters = ['agent', sessionId, command] as const;
    const change = this.creation.commit(null, commandId, parameters, { kind: 'review' }, () => {
      const changes = this.review.list(workId, sessionId);
      const existing = changes.find(
        (item): item is EntryChange => item.target === 'entry' && item.targetId === entryId
      );
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
      const covered = changes.filter(
        item => item.target === 'entry' && item.id !== existing?.id && removed.has(item.targetId)
      );
      for (const item of covered) this.repository.library.putPendingChange(advanceChange(item, { status: 'covered' }));
      const version = randomUUID();
      const next: EntryChange = {
        target: 'entry',
        id: existing?.id ?? randomUUID(),
        workId,
        sessionId,
        targetId: entryId,
        version,
        order: existing?.order ?? Math.max(0, ...changes.map(item => item.order)) + 1,
        base: current,
        candidate: { ...current, revisionId: version },
        conflicts: [],
        authorEdited: existing !== undefined && existing.authorEdited,
        status: 'pending',
        deleted: true,
        covers: covered.map(item => item.id),
        updatedAt: Date.now()
      };
      this.repository.library.putPendingChange(next);

      return next;
    });
    return change.deleted ? { kind: 'pending', change } : { kind: 'withdrawn', change };
  }

  private existingEntry(workId: string, entryId: string): EntrySnapshot {
    if (!this.repository.library.hasWork(workId)) throw new Error('作品不存在');
    assertNotTrashed(this.repository.work(workId), entryId);
    const current = readEntrySnapshot(this.repository.work(workId), entryId);
    if (!current) throw new Error('条目不存在');
    return current;
  }

  private write(context: CreationAgentContext, command: WriteCommand): AgentWriteResult {
    if (context.mode === 'discuss') throw new Error('当前为讨论模式，作品只读');
    const { workId, commandId } = command.input;
    const parameters = ['agent', context.sessionId, command] as const;
    if (context.mode === 'direct') {
      const receipt = this.repository.work(workId).readReceipt<Entry>(commandId, parameters);
      if (receipt) return { kind: 'saved', entry: receipt };

      const { base, candidate } = this.propose(context, command);
      return {
        kind: 'saved',
        entry: this.creation.commitSnapshot({
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
      const { base, candidate, existing } = this.propose(context, command);
      const order =
        existing && command.method !== 'moveEntry'
          ? existing.order
          : Math.max(0, ...this.review.list(workId, context.sessionId).map(item => item.order)) + 1;
      const change: EntryChange = {
        target: 'entry',
        id: existing?.id ?? randomUUID(),
        workId,
        sessionId: context.sessionId,
        targetId: candidate.id,
        version: candidate.revisionId,
        order,
        base,
        candidate,
        conflicts: [],
        authorEdited: existing !== undefined && existing.authorEdited,
        status: 'pending',
        updatedAt: Date.now()
      };
      this.repository.library.putPendingChange(change);

      return change;
    });
    return { kind: 'pending', change: pending };
  }

  private propose(context: CreationAgentContext, command: WriteCommand) {
    const { sessionId, mode } = context;
    const { workId } = command.input;
    if (!this.repository.library.hasWork(workId)) throw new Error('作品不存在');
    const entryId = targetId(command);
    const existing =
      entryId === null || mode !== 'review'
        ? undefined
        : this.review
            .list(workId, sessionId)
            .find((change): change is EntryChange => change.target === 'entry' && change.targetId === entryId);
    if (entryId !== null) assertNotTrashed(this.repository.work(workId), entryId);
    const current = entryId === null ? null : readEntrySnapshot(this.repository.work(workId), entryId);
    const entries = mode === 'review' ? this.entries(workId, sessionId) : this.creation.listEntries(workId);
    const proposal = proposeEntry(command, entries, current, existing);
    // Agent 只能保留或移动已有插图，不能新建插图引用。
    const kept = illustrationIds(existing?.candidate.content ?? current?.content ?? '');
    for (const id of illustrationIds(proposal.candidate.content ?? ''))
      if (!kept.has(id)) throw new Error('不能新建插图，只能保留或移动正文中已有的插图');
    return { ...proposal, existing };
  }
}

type DeleteCommand = Extract<AgentWriteCommand, { method: 'deleteEntry' }>;
type WriteCommand = EntryWriteCommand;

function targetId(command: WriteCommand): string | null {
  if (command.method === 'createEntry') return null;
  return 'documentId' in command.input ? command.input.documentId : command.input.entryId;
}
