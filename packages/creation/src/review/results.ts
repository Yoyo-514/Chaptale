import { diffComm } from 'node-diff3';

import { sameAttributes } from '../content/entries.ts';
import { readEntrySnapshot } from '../content/mutations.ts';
import type {
  DecideReviewInput,
  ReviewDecision,
  ReviewResult,
  ReviewResultContent,
  ReviewResultValue,
  ReviewView
} from '../contracts/index.ts';
import type { CreationRepository } from '../repository.ts';
import { sameContent } from './entry/blocks.ts';
import { isStoryView } from './ledger.ts';
import { recordSnapshot } from './record/merge.ts';
import { relationSnapshot } from './relation/merge.ts';

/** 决定时保存原文与候选片段；发消息时读取最新正式稿。 */
export class ReviewResults {
  private readonly repository: CreationRepository;
  constructor(repository: CreationRepository) {
    this.repository = repository;
  }

  prepare(
    view: ReviewView,
    input: Pick<DecideReviewInput, 'commandId' | 'decision' | 'range' | 'part'>,
    decision: ReviewDecision = input.decision === 'accept' ? 'accepted' : 'rejected'
  ): ReviewResult[] {
    const { change } = view;
    const label = isStoryView(view, 'record')
      ? view.candidate.text
      : isStoryView(view, 'relation')
        ? view.candidate.type
        : view.candidate.title;
    const results: ReviewResult[] = [];
    const add = (part: ReviewResult['part'], before: ReviewResultValue, proposed: ReviewResultValue) =>
      results.push({
        id: JSON.stringify([input.commandId, change.id, results.length]),
        workId: change.workId,
        sessionId: change.sessionId,
        changeId: change.id,
        targetId: change.targetId,
        target: change.target,
        label,
        part,
        decision,
        authorEdited: change.authorEdited,
        before,
        proposed
      });
    if (isStoryView(view)) {
      add(change.target, view.current, view.candidate);
      return results;
    }
    const { current, candidate } = view;
    // 正式稿已与候选一致时，整项确认仍由作者完成。
    if (change.deleted || !current || sameContent(current, candidate)) {
      add('entry', current, candidate);
      return results;
    }
    if (input.range) {
      const { fromA, toA, fromB, toB } = input.range;
      add('body', current.content!.slice(fromA, toA), candidate.content!.slice(fromB, toB));
      return results;
    }
    if (input.part === 'title') add('title', current.title, candidate.title);
    else if (input.part === 'attributes') add('attributes', current.attributes, candidate.attributes);
    else {
      if (current.title !== candidate.title) add('title', current.title, candidate.title);
      if (!sameAttributes(current.attributes, candidate.attributes))
        add('attributes', current.attributes, candidate.attributes);
      if (current.parentId !== candidate.parentId || current.position !== candidate.position)
        add(
          'location',
          { parentId: current.parentId, position: current.position },
          { parentId: candidate.parentId, position: candidate.position }
        );
      if (current.content !== candidate.content && current.content !== null && candidate.content !== null)
        for (const region of diffComm(current.content.split('\n'), candidate.content.split('\n')))
          if (region.buffer1) add('body', region.buffer1.join('\n'), region.buffer2.join('\n'));
      if (current.format !== candidate.format) add('entry', current, candidate);
    }
    return results;
  }

  put(results: ReviewResult[]): void {
    for (const result of results) this.repository.library.putReviewResult(result);
  }

  list(sessionId: string): ReviewResultContent[] {
    const snapshots = new Map<string, ReviewResultContent['snapshot']>();
    return this.repository.library.listReviewResults(sessionId).map(result => {
      if (!this.repository.library.hasWork(result.workId)) return { ...result, snapshot: null };
      const key = JSON.stringify([result.workId, result.target, result.targetId]);
      if (snapshots.has(key)) return { ...result, snapshot: snapshots.get(key)! };
      const work = this.repository.work(result.workId);
      let snapshot: ReviewResultContent['snapshot'];
      if (result.target === 'entry') snapshot = readEntrySnapshot(work, result.targetId);
      else if (result.target === 'record') {
        const record = work.getRecord(result.targetId);
        snapshot = record ? recordSnapshot(record) : null;
      } else {
        const relation = work.getRelation(result.targetId);
        snapshot = relation ? relationSnapshot(relation) : null;
      }
      snapshots.set(key, snapshot);
      return { ...result, snapshot };
    });
  }

  report(sessionId: string, resultIds: string[]): null {
    this.repository.library.reportReviewResults(sessionId, resultIds);
    return null;
  }
}
