import type { AgentSession } from '@earendil-works/pi-coding-agent';

import type { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, ReviewResultContent } from '@chaptale/creation/contracts';

import { reviewResultsMessageType } from '../protocol.ts';

export interface ReviewResultsDetails {
  resultIds: string[];
  count: number;
  outcomes: string[];
}
const decisions = {
  accepted: '已接受',
  rejected: '已拒绝',
  deleted: '作者已删除该条目',
  sourceDeleted: '作者已删除来源章节',
  sourceRejected: '作者拒绝了来源正文'
} as const;
const parts = {
  body: '正文',
  title: '改名',
  attributes: '资料属性',
  location: '目录移动',
  entry: '条目',
  record: '事件',
  relation: '关系'
} as const;
function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 复用 SDK 原生上下文消息；入队期间去重，本机进度只确认已写入 JSONL 的结果。 */
export class SessionReviewResults {
  private readonly issued = new Set<string>();
  private readonly session: AgentSession;
  private readonly creation: CreationApplication;
  constructor(session: AgentSession, creation: CreationApplication) {
    this.session = session;
    this.creation = creation;
  }

  private persisted(): Set<string> {
    return new Set(
      this.session.sessionManager
        .getBranch()
        .flatMap(entry =>
          entry.type === 'custom_message' && entry.customType === reviewResultsMessageType
            ? (entry.details as ReviewResultsDetails).resultIds
            : []
        )
    );
  }
  private report(resultIds: string[]): void {
    if (!resultIds.length) return;
    value(
      this.creation.executeAuthor({
        method: 'reportReviewResults',
        input: { sessionId: this.session.sessionId, resultIds }
      })
    );
    for (const id of resultIds) this.issued.delete(id);
  }
  prepare() {
    const pending = value(
      this.creation.executeAuthor({ method: 'listReviewResults', input: { sessionId: this.session.sessionId } })
    );
    if (!pending.length) return undefined;
    const persisted = this.persisted();
    this.report(pending.filter(result => persisted.has(result.id)).map(result => result.id));
    const results = pending.filter(
      result => !persisted.has(result.id) && !(this.session.isStreaming && this.issued.has(result.id))
    );
    if (!results.length) return undefined;
    const resultIds = results.map(result => result.id);
    for (const id of resultIds) this.issued.add(id);
    const outcomes = results.map(describe);
    // 一个目标的正式稿只附一次，各处决定仍分别保留原文与候选片段。
    const official = [
      ...new Map(
        results.map(result => [
          JSON.stringify([result.workId, result.target, result.targetId]),
          {
            workId: result.workId,
            target: result.target,
            targetId: result.targetId,
            snapshot: result.snapshot
          }
        ])
      ).values()
    ];
    return {
      customType: reviewResultsMessageType,
      display: true,
      content: [
        '作者已处理以下修改：',
        ...outcomes.map(outcome => `- ${outcome}`),
        `各处决定与原文、候选片段：${JSON.stringify(results.map(({ snapshot: _snapshot, ...result }) => result))}`,
        `当前正式内容：${JSON.stringify(official)}`,
        '被拒绝或改写的部分是作者的决定，不要原样重做；确实需要再改时，先说明理由并询问作者。仍待审的内容保留为候选，按作者接下来的消息行动。'
      ].join('\n'),
      details: { resultIds, count: results.length, outcomes } satisfies ReviewResultsDetails
    };
  }
  acknowledge(): void {
    if (!this.issued.size) return;
    const persisted = this.persisted();
    this.report([...this.issued].filter(id => persisted.has(id)));
  }
}
function describe(result: ReviewResultContent): string {
  const label = result.target === 'entry' ? `《${result.label}》` : `${parts[result.part]}“${result.label}”`;
  return `${label}${result.target === 'entry' ? `·${parts[result.part]}` : ''}${decisions[result.decision]}${result.authorEdited ? '（作者逐处决定或手改过，以正式内容为准）' : ''}`;
}
