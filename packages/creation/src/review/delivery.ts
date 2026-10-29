import { randomUUID } from 'node:crypto';

import { readEntrySnapshot } from '../content/mutations.ts';
import type {
  DeliveryContent,
  DeliveryDecision,
  DeliveryGroup,
  DeliveryProgressInput,
  DeliveryView,
  PendingChange
} from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import type { CreationService } from '../service.ts';
import { recordSnapshot } from './record/merge.ts';

/** 自动归集待审修改；作者处理完成后继续，或结束任务把剩余候选留作历史待审。 */
export class DeliveryService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;

  constructor(repository: CreationRepository, creation: CreationService) {
    this.repository = repository;
    this.creation = creation;
  }

  /** 已结束的组不再是当前任务；它之后的第一处修改另开新组。 */
  current(sessionId: string): DeliveryView | null {
    const group = this.repository.library.getCurrentDelivery(sessionId);
    return group && group.status !== 'ended' ? { group, pendingCount: this.pendingCount(group) } : null;
  }

  read(groupId: string): DeliveryView {
    const group = this.repository.library.getDeliveryGroup(groupId);
    if (!group) throw new Error('待审修改组不存在');
    return { group, pendingCount: this.pendingCount(group) };
  }

  /** 当前组及仍有待审修改的历史组。 */
  list(sessionId: string): DeliveryGroup[] {
    const current = this.current(sessionId)?.group;
    return this.repository.library
      .listDeliveryGroups(sessionId)
      .filter(group => group.id === current?.id || (group.status === 'ended' && this.pendingCount(group) > 0));
  }

  contents(groupId: string): DeliveryContent[] {
    return this.read(groupId).group.changeIds.map((id): DeliveryContent => {
      const change = this.repository.library.getPendingChange(id)!;
      const work = this.repository.work(change.workId);
      const trashed =
        change.target === 'entry' ? work.isTrashed(change.targetId) : work.isRecordTrashed(change.targetId);
      const decision: DeliveryDecision = change.authorEdited
        ? 'edited'
        : change.status === 'rejected' && trashed
          ? 'deleted'
          : (change.status as 'accepted' | 'rejected');
      const fields = { workId: change.workId, targetId: change.targetId, decision };
      if (change.target === 'entry')
        return {
          target: 'entry',
          ...fields,
          title: change.candidate.title,
          snapshot: readEntrySnapshot(work, change.targetId)
        };
      const record = work.getRecord(change.targetId);
      return {
        target: 'record',
        ...fields,
        text: change.candidate.text,
        snapshot: record ? recordSnapshot(record) : null
      };
    });
  }

  /** 早前任务保留的候选由作者先处理，新任务不接管或覆盖它。 */
  assertWritable(sessionId: string, workId: string, targetId: string | null): void {
    if (targetId === null) return;
    const change = this.repository.library
      .listPendingChanges(workId, sessionId)
      .find(candidate => candidate.targetId === targetId);
    if (change && !this.current(sessionId)?.group.changeIds.includes(change.id))
      throw new Error('该内容有早前任务的待接受修改，请作者先处理');
  }

  /** 与候选在同一事务中登记，中途问答及重启沿用本组。 */
  attach(change: PendingChange): void {
    const previous = this.repository.library.getCurrentDelivery(change.sessionId);
    const current = previous?.status === 'pending' ? previous : undefined;
    const group: DeliveryGroup = {
      id: current?.id ?? randomUUID(),
      sessionId: change.sessionId,
      version: randomUUID(),
      status: 'pending',
      changeIds: current ? [...current.changeIds] : []
    };
    if (!group.changeIds.includes(change.id)) group.changeIds.push(change.id);
    this.repository.library.putDeliveryGroup(group);
  }

  /** 撤回的候选从所在组移除，不计入续跑结果。 */
  detach(change: PendingChange): void {
    const group = this.repository.library.getCurrentDelivery(change.sessionId);
    if (!group?.changeIds.includes(change.id)) return;
    this.repository.library.putDeliveryGroup({
      ...group,
      version: randomUUID(),
      changeIds: group.changeIds.filter(id => id !== change.id)
    });
  }

  continue(input: DeliveryProgressInput): DeliveryGroup {
    return this.advance('continueDelivery', input, 'continued', current => {
      if (current.pendingCount > 0) throw new Error('请先接受或拒绝本组剩余修改，再继续');
    });
  }

  end(input: DeliveryProgressInput): DeliveryGroup {
    return this.advance('endDelivery', input, 'ended', () => {});
  }

  pendingCount(group: DeliveryGroup): number {
    return group.changeIds.filter(id => this.repository.library.getPendingChange(id)!.status === 'pending').length;
  }

  private advance(
    method: 'continueDelivery' | 'endDelivery',
    input: DeliveryProgressInput,
    status: DeliveryGroup['status'],
    check: (current: DeliveryView) => void
  ): DeliveryGroup {
    return this.creation.commit(null, input.commandId, [method, input], { kind: 'delivery' }, () => {
      const current = this.current(input.sessionId);
      if (
        !current ||
        current.group.id !== input.groupId ||
        current.group.version !== input.expectedVersion ||
        current.group.status !== 'pending'
      )
        throw new Error('待审修改已变化，请刷新后继续');
      check(current);
      const group: DeliveryGroup = { ...current.group, version: randomUUID(), status };
      this.repository.library.putDeliveryGroup(group);
      return group;
    });
  }
}
