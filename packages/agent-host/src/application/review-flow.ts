import type { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';

import { type EditMode, reviewContinuationMessageType, type SessionView } from '../protocol.ts';

const decisionLabels = {
  accepted: '已接受',
  rejected: '已拒绝',
  edited: '作者逐处决定或手改过，以正式内容为准',
  deleted: '作者已删除该条目',
  sourceDeleted: '作者已删除来源章节',
  sourceRejected: '作者拒绝了来源正文'
} as const;

function creationValue<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 作者处理完一组修改后发给模型的继续消息。 */
export interface ReviewContinuation {
  customType: typeof reviewContinuationMessageType;
  content: string;
  display: boolean;
  details: { groupId: string; count: number; outcomes: string[] };
}

/**
 * 会话的审阅交付进度：延后切换模式、等待作者处理，以及处理完成后的续跑消息。
 * 进度全部读自作品服务；这里只改写会话视图中的模式与交付字段，推送由会话负责。
 */
export class ReviewFlow {
  private readonly view: SessionView;
  private readonly creation?: CreationApplication;
  private selectedMode: EditMode;
  private directAfterGroupId?: string;
  private waitingGroupId?: string;

  constructor(
    view: SessionView,
    mode: EditMode,
    options: { creation?: CreationApplication; directAfterGroupId?: string }
  ) {
    this.view = view;
    this.creation = options.creation;
    this.selectedMode = mode;
    this.directAfterGroupId = options.directAfterGroupId;
  }

  /** 读取当前交付组并按延后切换的进度生效模式；返回生效模式是否变化。 */
  refresh(): boolean {
    const { view } = this;
    const previousMode = view.mode;
    view.mode = this.selectedMode;
    delete view.switchingTo;
    if (this.creation) {
      view.delivery = creationValue(
        this.creation.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: view.sessionId! } })
      );
    }
    if (this.directAfterGroupId) {
      if (!this.creation) throw new Error('当前宿主未接入作品服务，无法恢复延后切换');
      const delivery = creationValue(
        this.creation.executeAuthor({ method: 'readDeliveryGroup', input: { groupId: this.directAfterGroupId } })
      );
      // 继续或作者结束该组任务后，延后的直接修改生效。
      if (delivery.group.status !== 'pending') view.mode = 'direct';
      else view.switchingTo = 'direct';
    }
    return view.mode !== previousMode;
  }

  /** 审阅中切到直接修改且仍有待审时延后生效；返回需要记入历史的模式条目。 */
  select(mode: EditMode): { mode: EditMode; directAfterGroupId?: string } {
    this.refresh();
    let directAfterGroupId: string | undefined;
    if (mode === 'direct' && this.view.mode === 'review') {
      if (this.directAfterGroupId) directAfterGroupId = this.directAfterGroupId;
      else if (this.view.delivery && this.view.delivery.pendingCount > 0)
        directAfterGroupId = this.view.delivery.group.id;
    }
    this.selectedMode = directAfterGroupId ? 'review' : mode;
    this.directAfterGroupId = directAfterGroupId;
    return { mode: this.selectedMode, directAfterGroupId };
  }

  /** 调用方已刷新进度；本次工具写入待审修改后，Agent 继续完成任务，任务结束后等待作者处理。返回是否进入等待。 */
  written(): boolean {
    const delivery = this.view.delivery!;
    if (delivery.group.status !== 'pending' || delivery.pendingCount === 0) return false;
    this.waitingGroupId = delivery.group.id;
    this.view.waitingForReview = true;
    return true;
  }

  /** 作者重新发起任务：先提交已处理组的继续进度，当前组仍有待审时重新等待。 */
  beforePrompt(): ReviewContinuation | undefined {
    this.refresh();
    const continuation = this.continuation();
    if (continuation) this.clearWaiting();
    const delivery = this.view.delivery;
    if (delivery && delivery.pendingCount > 0) {
      this.waitingGroupId = delivery.group.id;
      this.view.waitingForReview = true;
    }
    return continuation;
  }

  /** 等待中的组处理完后返回续跑消息；作者结束了该组任务时放弃自动续跑。 */
  resume(): ReviewContinuation | undefined {
    if (!this.waitingGroupId) return undefined;
    const delivery = this.view.delivery;
    if (delivery?.group.id !== this.waitingGroupId) {
      // 作者结束了等待中的任务：剩余候选转为历史待审，本次任务不再自动续跑。
      this.clearWaiting();
      return undefined;
    }
    if (this.view.running || delivery.pendingCount > 0) return undefined;
    // 先消耗本轮资格，重复决定、重复事件和请求失败都不会再次自动发起。
    delete this.waitingGroupId;
    delete this.view.waitingForReview;
    return this.continuation();
  }

  clearWaiting(): void {
    delete this.waitingGroupId;
    delete this.view.waitingForReview;
  }

  /** 复用已有回执提交继续进度，并在发起下一次请求前捕获正式内容。 */
  private continuation(): ReviewContinuation | undefined {
    const delivery = this.view.delivery;
    if (!delivery || delivery.pendingCount > 0 || delivery.group.status !== 'pending') return undefined;
    const { group } = delivery;
    const contents = creationValue(
      this.creation!.executeAuthor({ method: 'readDeliveryContents', input: { groupId: group.id } })
    );
    creationValue(
      this.creation!.executeAuthor({
        method: 'continueDelivery',
        input: {
          commandId: JSON.stringify(['review-resolved', group.id, group.version]),
          sessionId: this.view.sessionId!,
          groupId: group.id,
          expectedVersion: group.version
        }
      })
    );
    this.refresh();
    const outcomes = contents.map(
      item =>
        `${item.target === 'entry' ? `《${item.title}》` : item.target === 'record' ? `事件“${item.text}”` : `关系“${item.type}”`}${decisionLabels[item.decision]}`
    );
    const official = contents.map(item =>
      item.target === 'entry'
        ? { workId: item.workId, entryId: item.targetId, snapshot: item.snapshot }
        : item.target === 'record'
          ? { workId: item.workId, recordId: item.targetId, snapshot: item.snapshot }
          : { workId: item.workId, relationId: item.targetId, snapshot: item.snapshot }
    );
    return {
      customType: reviewContinuationMessageType,
      content: [
        '作者已处理本组修改：',
        ...outcomes.map(line => `- ${line}`),
        `处理后的正式内容：${JSON.stringify(official)}`,
        '被拒绝或改写的部分是作者的决定，不要原样重做；确实需要再改时，先说明理由并询问作者。请根据这些正式内容继续剩余任务。'
      ].join('\n'),
      display: true,
      details: { groupId: group.id, count: contents.length, outcomes }
    };
  }
}
