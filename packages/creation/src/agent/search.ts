import type {
  AgentRecord,
  AgentRelation,
  CreationAgentContext,
  Entry,
  EntryReviewView,
  SearchMatchSource,
  SearchPassage,
  SearchWorkInput,
  WorkSearchHit,
  WorkSearchPage
} from '../contracts/index.ts';
import { chapterOrder, groupByPlacement } from '../contracts/index.ts';
import type { CreationRepository, SearchNote, WorkRepository, WorkSearchMatches } from '../repository.ts';
import { overlayEntries } from '../review/entry/overlay.ts';
import type { ReviewService } from '../review/service.ts';
import { matchingPassages, passagesPerEntry, splitPassages } from '../search/passages.ts';
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

function uniqueTexts(sources: readonly VectorSource[]): VectorText[] {
  return [...new Map(sources.flatMap(source => source.texts).map(text => [text.hash, text])).values()];
}

/** 一部作品的正式内容里要算向量的文字，同样的文字只列一次。 */
export function formalVectorTexts(services: SearchServices, workId: string): VectorText[] {
  return uniqueTexts(vectorSources(searchScope(services, formalView, { workId })));
}

/** 一次检索范围里要算向量的文字，含本会话待接受的修改，同样的文字只列一次。 */
export function searchVectorTexts(
  services: SearchServices,
  context: CreationAgentContext,
  { workId, section, asOf }: SearchWorkInput
): VectorText[] {
  return uniqueTexts(vectorSources(searchScope(services, context, { workId, section, asOf }), section));
}

/** 语义检索取与问题最接近的这么多段，不设相似度门槛。 */
const semanticLaneSize = 20;
/** 合并关键词与语义两路排名（RRF）用的常数：名次越靠前得分越高，两路都命中的相加。 */
const fusionConstant = 60;

type MatchTarget = WorkSearchMatches['matches'][number];
interface SemanticMatch extends MatchTarget {
  similarity: number;
  /** 条目里进入前 semanticLaneSize 的段落，最接近的在前。 */
  passages: SearchPassage[];
}

/** 按与问题的相似度排列的命中；一个条目有多段入选时排在它最接近的那段的位置。还没有向量的文字不参与。 */
function semanticMatches(scope: SearchScope, section: Entry['section'] | undefined, question: Float32Array) {
  const scores = scope.work.vectorScores(question);
  const nearest = vectorSources(scope, section)
    .flatMap(({ target, texts }) => {
      const found = texts.flatMap(text => scores.get(text.hash) ?? []);
      return found.length ? [{ target, similarity: Math.max(...found) }] : [];
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, semanticLaneSize);
  const matches = new Map<string, SemanticMatch>();
  for (const { target, similarity } of nearest) {
    const key = `${target.kind}:${target.id}`;
    const match = matches.get(key) ?? { kind: target.kind, id: target.id, similarity, passages: [] };
    if (target.kind === 'entry') match.passages.push(target.passage);
    matches.set(key, match);
  }
  return [...matches.values()];
}

/** 语义和关键词各自挑出的段落合在一起：两边都挑中的优先，其次语义，按原文顺序排列。 */
function mergePassages(semantic: readonly SearchPassage[], keyword: readonly SearchPassage[]): SearchPassage[] {
  const keywordLines = new Set(keyword.map(passage => passage.startLine));
  const semanticLines = new Set(semantic.map(passage => passage.startLine));
  return [
    ...semantic.filter(passage => keywordLines.has(passage.startLine)),
    ...semantic.filter(passage => !keywordLines.has(passage.startLine)),
    ...keyword.filter(passage => !semanticLines.has(passage.startLine))
  ]
    .slice(0, passagesPerEntry)
    .sort((a, b) => a.startLine - b.startLine);
}

type RankedMatch = MatchTarget & SearchMatchSource & { passages?: SearchPassage[] };

/**
 * Agent 检索一部作品：正文与资料返回命中段落，事件和关系返回记录本身；审阅模式看到的是本会话视图。
 * asOf 之后的章节不参与，事件和关系按发生位置截取，资料不随进度。
 * query 按关键词检索；question 是 input.question 的向量，由调用 embedding 服务的宿主算好传入，没有它时不做语义检索。
 */
export function searchWork(
  services: SearchServices,
  context: CreationAgentContext,
  input: SearchWorkInput,
  question?: Float32Array
): WorkSearchPage {
  const { workId, section, offset, limit, query } = input;
  if (query === undefined && input.question === undefined) throw new Error('query 和 question 至少给一个');
  const scope = searchScope(services, context, { workId, section, asOf: input.asOf });
  const { work, candidates, asOf } = scope;

  const semantic = question && semanticMatches(scope, section, question);
  const keyword =
    query === undefined
      ? { terms: [], matches: [], hasMore: false }
      : work.searchWork({
          query,
          ...(section !== undefined && { section }),
          // 合并排名要用整条关键词排名，命中数不会超过范围里的条目、事件和关系总数。
          ...(semantic
            ? { offset: 0, limit: Math.max(1, scope.entries.size + scope.notes.length) }
            : { offset, limit }),
          candidates: [...candidates.values()],
          hidden: scope.hidden,
          notes: scope.notes
        });

  let ranked: RankedMatch[] = keyword.matches.map(match => ({ ...match, matchedBy: 'keyword' }));
  let hasMore = keyword.hasMore;
  if (semantic) {
    const fused = new Map<string, RankedMatch & { score: number }>();
    for (const [rank, match] of keyword.matches.entries())
      fused.set(`${match.kind}:${match.id}`, {
        ...match,
        matchedBy: 'keyword',
        score: 1 / (fusionConstant + rank + 1)
      });
    for (const [rank, match] of semantic.entries()) {
      const key = `${match.kind}:${match.id}`;
      const byKeyword = fused.get(key);
      fused.set(key, {
        ...match,
        matchedBy: byKeyword ? 'both' : 'semantic',
        score: 1 / (fusionConstant + rank + 1) + (byKeyword?.score ?? 0)
      });
    }
    // 得分相同时关键词命中在前。
    const all = [...fused.values()].sort((a, b) => b.score - a.score);
    ranked = all.slice(offset, offset + limit);
    hasMore = all.length > offset + limit;
  }

  const hits = ranked.map((match): WorkSearchHit => {
    const source: SearchMatchSource = {
      matchedBy: match.matchedBy,
      ...(match.similarity !== undefined && { similarity: match.similarity })
    };
    if (match.kind === 'record') return { kind: 'record', record: scope.records.get(match.id)!, ...source };
    if (match.kind === 'relation') return { kind: 'relation', relation: scope.relations.get(match.id)!, ...source };
    const entry = scope.entries.get(match.id)!;
    const content = contentOf(scope, entry);
    return {
      kind: 'entry',
      entry,
      pending: candidates.has(match.id),
      ignoresAsOf: asOf !== null && entry.section === 'resource',
      passages: mergePassages(
        match.passages ?? [],
        content === null || match.matchedBy === 'semantic' ? [] : matchingPassages(content, keyword.terms)
      ),
      ...source
    };
  });
  return { hits, hasMore };
}
