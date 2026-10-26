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
  PendingChange
} from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import type { DeliveryService } from '../review/delivery.ts';
import { overlayEntries } from '../review/overlay.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';
import { proposeEntry } from './proposal.ts';

type AgentValue = Extract<CreationAgentCommands[keyof CreationAgentCommands]['output'], { ok: true }>['value'];

/** Agent 用例的身份与模式边界；候选和正式提交使用相同的内容领域规则。 */
export class CreationAgentService {
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
        const candidates = this.review
          .list(command.input.workId, context.sessionId)
          .map(change => this.review.read(change.id).candidate);
        return this.repository.searchDocuments(command.input, candidates);
      }
      default:
        return this.write(context, command);
    }
  }

  private entries(workId: string, sessionId: string): Entry[] {
    const views = this.review.list(workId, sessionId).map(change => this.review.read(change.id));
    return overlayEntries(this.creation.listEntries(workId), views);
  }

  private write(context: CreationAgentContext, command: AgentWriteCommand): AgentWriteResult {
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

  private propose(context: CreationAgentContext, command: AgentWriteCommand) {
    const { sessionId, mode } = context;
    const { workId } = command.input;
    if (!this.repository.hasWork(workId)) throw new Error('作品不存在');
    const entryId = targetId(command);
    const existing =
      entryId === null || mode !== 'review'
        ? undefined
        : this.review.list(workId, sessionId).find(change => change.entryId === entryId);
    const current = entryId === null ? null : readEntrySnapshot(this.repository, workId, entryId);
    const entries = mode === 'review' ? this.entries(workId, sessionId) : this.creation.listEntries(workId);
    return { ...proposeEntry(command, entries, current, existing), existing };
  }
}

function targetId(command: AgentWriteCommand): string | null {
  if (command.method === 'createEntry') return null;
  return 'documentId' in command.input ? command.input.documentId : command.input.entryId;
}
