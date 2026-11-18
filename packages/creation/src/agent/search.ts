import type {
  AgentRecord,
  AgentRelation,
  CreationAgentContext,
  Entry,
  EntryReviewView,
  SearchPassage,
  SearchWorkInput,
  WorkSearchHit,
  WorkSearchPage
} from '../contracts/index.ts';
import { chapterOrder, groupByPlacement } from '../contracts/index.ts';
import type { CreationRepository, SearchNote, WorkRepository } from '../repository.ts';
import { overlayEntries } from '../review/entry/overlay.ts';
import type { ReviewService } from '../review/service.ts';
import { matchingPassages, splitPassages } from '../search/passages.ts';
import { noteVectorText, passageVectorTexts, type VectorText } from '../search/vector-texts.ts';
import type { AgentRecordService } from './records.ts';
import type { AgentRelationService } from './relations.ts';

export interface SearchServices {
  repository: CreationRepository;
  review: ReviewService;
  records: AgentRecordService;
  relations: AgentRelationService;
}

/** 一次检索能看到的内容：条目（审阅模式下含本会话待接受的修改）、事件和关系，都已按进度截取。 */
interface SearchScope {
  work: WorkRepository;
  /** 可见的条目，含 asOf 之后的章节。 */
  entries: Map<string, Entry>;
  /** 本会话改过的条目，正文以它为准。 */
  candidates: Map<string, EntryReviewView['candidate']>;
  /** asOf 之后的章节，不参与检索。 */
  later: Set<string>;
  /** 正式索引里要跳过的条目：本会话待删除的和 asOf 之后的。 */
  hidden: string[];
  notes: SearchNote[];
  records: Map<string, AgentRecord>;
  relations: Map<string, AgentRelation>;
  asOf: string | null;
}

function searchScope(
  { repository, review, records, relations }: SearchServices,
  context: CreationAgentContext,
  { workId, section, asOf = null }: { workId: string; section?: Entry['section']; asOf?: string | null }
): SearchScope {
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
  return {
    work,
    entries: visible,
    candidates,
    later,
    hidden: [...formal.filter(entry => !visible.has(entry.id)).map(entry => entry.id), ...later],
    notes,
    records: foundRecords,
    relations: foundRelations,
    asOf
  };
}

/** 条目在这次检索里的正文；目录和文件条目没有正文。 */
function contentOf(scope: SearchScope, entry: Entry): string | null {
  const candidate = scope.candidates.get(entry.id);
  if (candidate) return candidate.content;
  return entry.kind === 'document' ? scope.work.getDocument(entry.id)!.content : null;
}

/** 检索范围里每个段落、事件和关系要算向量的文字，连同它属于谁。 */
export interface VectorSource {
  target: { kind: 'entry'; id: string; passage: SearchPassage } | { kind: 'record' | 'relation'; id: string };
  texts: VectorText[];
}

function vectorSources(scope: SearchScope, section?: Entry['section']): VectorSource[] {
  const sources: VectorSource[] = [];
  for (const entry of scope.entries.values()) {
    if (scope.later.has(entry.id) || (section !== undefined && entry.section !== section)) continue;
    const content = contentOf(scope, entry);
    if (content === null) continue;
    const title = scope.candidates.get(entry.id)?.title ?? entry.title;
    for (const passage of splitPassages(content))
      sources.push({ target: { kind: 'entry', id: entry.id, passage }, texts: passageVectorTexts(title, passage) });
  }
  for (const note of scope.notes) {
    const names = note.resourceIds.flatMap(id => scope.entries.get(id)?.title ?? []);
    sources.push({ target: { kind: note.kind, id: note.id }, texts: [noteVectorText(names, note.text)] });
  }
  return sources;
}

/** 讨论模式不叠加待接受的修改，看到的就是正式内容。 */
const formalView: CreationAgentContext = { sessionId: '', mode: 'discuss' };

/** 一部作品的正式内容里要算向量的文字，同样的文字只列一次。 */
export function formalVectorTexts(services: SearchServices, workId: string): VectorText[] {
  const texts = vectorSources(searchScope(services, formalView, { workId })).flatMap(source => source.texts);
  return [...new Map(texts.map(text => [text.hash, text])).values()];
}

/**
 * Agent 检索一部作品：正文与资料返回命中段落，事件和关系返回记录本身；审阅模式看到的是本会话视图。
 * asOf 之后的章节不参与，事件和关系按发生位置截取，资料不随进度。
 */
export function searchWork(
  services: SearchServices,
  context: CreationAgentContext,
  input: SearchWorkInput
): WorkSearchPage {
  const { workId, section, offset, limit } = input;
  const scope = searchScope(services, context, { workId, section, asOf: input.asOf });
  const { work, candidates, asOf } = scope;
  const visible = scope.entries;
  const foundRecords = scope.records;
  const foundRelations = scope.relations;

  const { terms, matches, hasMore } = work.searchWork({
    query: input.query,
    ...(section !== undefined && { section }),
    offset,
    limit,
    candidates: [...candidates.values()],
    hidden: scope.hidden,
    notes: scope.notes
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
