import type { PendingChange, RecordSource } from '../contracts.ts';
import type { WorkRepository } from '../repository.ts';
import { storySources } from './removal.ts';

type StoryChange = Exclude<PendingChange, { target: 'entry' }>;

/** 出处指向本会话待审正文的候选版本，尚未绑定正式修订。 */
export function unbound(
  work: WorkRepository,
  source: RecordSource
): source is Extract<RecordSource, { kind: 'chapter' }> {
  return source.kind === 'chapter' && work.getRevisionEntryId(source.revisionId) !== source.chapterId;
}

/** 候选中出处未绑定的章节。 */
export function draftChapters(work: WorkRepository, change: StoryChange): string[] {
  return [
    ...new Set(
      storySources(change)
        .filter(source => unbound(work, source))
        .map(source => (source as Extract<RecordSource, { kind: 'chapter' }>).chapterId)
    )
  ];
}

/** 接受时把未绑定的出处绑定该章当前正式修订：作者接受即视为已核对。 */
export function bindDraftSources<T extends StoryChange['candidate']>(work: WorkRepository, candidate: T): T {
  const bind = (source: RecordSource): RecordSource =>
    unbound(work, source) ? { ...source, revisionId: work.getEntry(source.chapterId)!.revisionId } : source;
  return 'milestones' in candidate
    ? { ...candidate, milestones: candidate.milestones.map(item => ({ ...item, source: bind(item.source) })) }
    : { ...candidate, source: bind(candidate.source) };
}
