import { randomUUID } from 'node:crypto';

import { readEntrySnapshot } from '../content/mutations.ts';
import type {
  ContinueDeliveryInput,
  DeliveryContent,
  DeliveryGroup,
  DeliveryView,
  PendingChange
} from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import type { CreationService } from '../service.ts';

/** 自动归集待审修改；作者处理完成后才能继续。 */
export class DeliveryService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;

  constructor(repository: CreationRepository, creation: CreationService) {
    this.repository = repository;
    this.creation = creation;
  }

  current(sessionId: string): DeliveryView | null {
    const group = this.repository.getCurrentDelivery(sessionId);
    return group ? { group, pendingCount: this.pendingCount(group) } : null;
  }

  read(groupId: string): DeliveryView {
    const group = this.repository.getDeliveryGroup(groupId);
    if (!group) throw new Error('待审修改组不存在');
    return { group, pendingCount: this.pendingCount(group) };
  }

  contents(groupId: string): DeliveryContent[] {
    return this.read(groupId).group.changeIds.map(id => {
      const change = this.repository.getPendingChange(id)!;
      return {
        workId: change.workId,
        entryId: change.entryId,
        snapshot: readEntrySnapshot(this.repository, change.workId, change.entryId)
      };
    });
  }

  /** 与候选在同一事务中登记，中途问答及重启沿用本组。 */
  attach(change: PendingChange, previousChange: PendingChange | undefined): void {
    const previous = this.repository.getCurrentDelivery(change.sessionId);
    const current = previous?.status === 'continued' ? undefined : previous;
    if (previousChange && !current?.changeIds.includes(change.id))
      throw new Error('该条目有另一任务的待接受修改，请先处理');
    const group: DeliveryGroup = {
      id: current?.id ?? randomUUID(),
      sessionId: change.sessionId,
      version: randomUUID(),
      status: 'pending',
      changeIds: current ? [...current.changeIds] : []
    };
    if (!group.changeIds.includes(change.id)) group.changeIds.push(change.id);
    this.repository.putDeliveryGroup(group);
  }

  continue(input: ContinueDeliveryInput): DeliveryGroup {
    return this.creation.commit(null, input.commandId, ['continueDelivery', input], { kind: 'delivery' }, () => {
      const current = this.current(input.sessionId);
      if (
        !current ||
        current.group.id !== input.groupId ||
        current.group.version !== input.expectedVersion ||
        current.group.status !== 'pending'
      )
        throw new Error('待审修改已变化，请刷新后继续');
      if (current.pendingCount > 0) throw new Error('请先接受或拒绝本组剩余修改，再继续');
      const group: DeliveryGroup = { ...current.group, version: randomUUID(), status: 'continued' };
      this.repository.putDeliveryGroup(group);
      return group;
    });
  }

  private pendingCount(group: DeliveryGroup): number {
    return group.changeIds.filter(id => this.repository.getPendingChange(id)!.status === 'pending').length;
  }
}
