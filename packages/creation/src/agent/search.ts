import type {
  AgentRecord,
  AgentRelation,
  CreationAgentContext,
  EntryReviewView,
  SearchWorkInput,
  WorkSearchHit,
  WorkSearchPage
} from '../contracts/index.ts';
import { chapterOrder, groupByPlacement } from '../contracts/index.ts';
import type { CreationRepository, SearchNote } from '../repository.ts';
import { overlayEntries } from '../review/entry/overlay.ts';
import type { ReviewService } from '../review/service.ts';
import { matchingPassages } from '../search/passages.ts';
import type { AgentRecordService } from './records.ts';
import type { AgentRelationService } from './relations.ts';

interface SearchServices {
  repository: CreationRepository;
  review: ReviewService;
  records: AgentRecordService;
  relations: AgentRelationService;
}

/**
 * Agent 检索一部作品：正文与资料返回命中段落，事件和关系返回记录本身；审阅模式看到的是本会话视图。
 * asOf 之后的章节不参与，事件和关系按发生位置截取，资料不随进度。
 */
export function searchWork(
  { repository, review, records, relations }: SearchServices,
  context: CreationAgentContext,
  input: SearchWorkInput
): WorkSearchPage {
  const { workId, section, offset, limit } = input;
  const asOf = input.asOf ?? null;
  const work = repository.work(workId);
  const formal = work.listEntries();
  const views =
    context.mode === 'review'
      ? review
          .list(workId, context.sessionId)
          .filter(change => change.target === 'entry')
          .map(change => review.read(change.id) as EntryReviewView)
      : [];
  const entries = overlayEntries(formal, views);
  const chapters = chapterOrder(entries);
  if (asOf !== null && !chapters.includes(asOf)) throw new Error('查看进度的章节不存在');
  const later = new Set(asOf === null ? [] : chapters.slice(chapters.indexOf(asOf) + 1));
  const visible = new Map(entries.map(entry => [entry.id, entry]));
  const candidates = new Map(
    views
      .filter(view => !view.change.deleted && !later.has(view.candidate.id))
      .map(view => [view.candidate.id, view.candidate])
  );

  // 限定分区时只检索条目。
  const foundRecords = new Map<string, AgentRecord>();
  const foundRelations = new Map<string, AgentRelation>();
  const notes: SearchNote[] = [];
  if (section === undefined) {
    for (const record of records.list(context, { workId, resourceId: null, sourceId: null, asOf })) {
      foundRecords.set(record.id, record);
      notes.push({
        kind: 'record',
        id: record.id,
        resourceIds: record.resourceIds,
        text: `${record.text} ${record.storyTime}`
      });
    }
    for (const listed of relations.list(context, { workId, resourceId: null, asOf }).relations) {
      const reached = new Set(groupByPlacement(listed.milestones, entries, asOf).flatMap(group => group.items));
      // 截至该进度尚未发生任何建立或结束的关系不出现。
      if (listed.milestones.length > 0 && reached.size === 0) continue;
      const relation = { ...listed, milestones: listed.milestones.filter(milestone => reached.has(milestone)) };
      foundRelations.set(relation.id, relation);
      notes.push({
        kind: 'relation',
        id: relation.id,
        resourceIds: relation.resourceIds,
        text: [relation.type, ...relation.titles, ...relation.milestones.map(milestone => milestone.storyTime)].join(
          ' '
        )
      });
    }
  }

  const { terms, matches, hasMore } = work.searchWork({
    query: input.query,
    ...(section !== undefined && { section }),
    offset,
    limit,
    candidates: [...candidates.values()],
    hidden: [...formal.filter(entry => !visible.has(entry.id)).map(entry => entry.id), ...later],
    notes
  });
  const hits = matches.map((match): WorkSearchHit => {
    if (match.kind === 'record') return { kind: 'record', record: foundRecords.get(match.id)! };
    if (match.kind === 'relation') return { kind: 'relation', relation: foundRelations.get(match.id)! };
    const entry = visible.get(match.id)!;
    const candidate = candidates.get(match.id);
    const content = candidate
      ? candidate.content
      : entry.kind === 'document'
        ? work.getDocument(entry.id)!.content
        : null;
    return {
      kind: 'entry',
      entry,
      pending: candidate !== undefined,
      ignoresAsOf: asOf !== null && entry.section === 'resource',
      passages: content === null ? [] : matchingPassages(content, terms)
    };
  });
  return { hits, hasMore };
}
