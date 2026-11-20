import { saveDocument } from '../content/mutations.ts';
import type {
  RecordSource,
  ReplaceTextInput,
  ReplaceTextReport,
  TextSearchTarget,
  UndoReplaceTextInput,
  UndoReplaceTextReport
} from '../contracts/index.ts';
import { applyRecordSnapshot } from '../records/commit.ts';
import { sameContent } from '../records/sources.ts';
import { applyRelationSnapshot } from '../relations/commit.ts';
import type { CreationRepository } from '../repository.ts';
import { recordSnapshot } from '../review/record/merge.ts';
import { relationSnapshot } from '../review/relation/merge.ts';
import { replacementFor, textScanner } from './text-search.ts';

type Field = ReplaceTextInput['excluded'][number]['field'];

/**
 * 在调用方的作品事务中替换搜索时选定的对象，每个对象只生成一条修订。
 * 对象在搜索之后变过时整批回滚；有待接受修改的对象跳过并列入 skipped。
 * 正文改动前已核对过的事件与关系节点，出处顺延到新修订。
 */
export function replaceText(repository: CreationRepository, input: ReplaceTextInput): ReplaceTextReport {
  const work = repository.work(input.workId);
  const pending = new Set(repository.library.listPendingChanges(input.workId, null).map(change => change.targetId));
  const report: ReplaceTextReport = { count: 0, revisions: [], skipped: [] };
  const targets = new Map(input.targets.map(target => [target.id, target]));
  const scan = textScanner(input);
  const excluded = new Set(input.excluded.map(hit => `${hit.id}:${hit.field}:${hit.line}:${hit.from}`));
  const chapters = new Map<string, { before: string; after: string }>();

  /** 把这段文字里没被划掉的命中换掉，其余字符（含换行与 BOM）原样保留。 */
  function replace(id: string, field: Field, text: string) {
    let output = '';
    let cursor = 0;
    for (const { line, from, start, end, groups } of scan(text)) {
      if (excluded.has(`${id}:${field}:${line}:${from}`)) continue;
      const value = replacementFor(input.replacement, input.regexp, groups);
      if (value === groups[0]) continue;
      output += text.slice(cursor, start) + value;
      cursor = end;
      report.count++;
    }
    return output + text.slice(cursor);
  }
  function checked<T extends { revisionId: string }>(target: TextSearchTarget, current: T | undefined): T {
    if (!current || current.revisionId !== target.revisionId) throw new Error('搜索结果已变化，请重新搜索后替换');
    return current;
  }
  /** 出处指向的章节这次被改了、且改之前就是核对过的，才跟到新修订。 */
  function advance(source: RecordSource): RecordSource {
    if (source.kind !== 'chapter') return source;
    const revision = chapters.get(source.chapterId);
    return revision && sameContent(work, source.revisionId, revision.before)
      ? { ...source, revisionId: revision.after }
      : source;
  }

  for (const target of targets.values()) {
    if (pending.has(target.id)) {
      report.skipped.push(target.id);
      continue;
    }
    if (target.kind === 'record') checked(target, work.getRecord(target.id));
    else if (target.kind === 'relation') checked(target, work.getRelation(target.id));
    else {
      const document = checked(target, work.getDocument(target.id));
      const content = replace(target.id, 'content', document.content);
      if (content === document.content) continue;
      const saved = saveDocument(work, {
        commandId: input.commandId,
        workId: input.workId,
        documentId: target.id,
        expectedRevisionId: target.revisionId,
        title: document.title,
        format: document.format,
        content
      });
      chapters.set(target.id, { before: target.revisionId, after: saved.revisionId });
      report.revisions.push({ ...target, previousRevisionId: target.revisionId, revisionId: saved.revisionId });
    }
  }
  for (const base of work.listRecords()) {
    if (pending.has(base.id)) continue;
    const text = targets.get(base.id)?.kind === 'record' ? replace(base.id, 'text', base.text) : base.text;
    const source = advance(base.source);
    if (text === base.text && source === base.source) continue;
    const saved = applyRecordSnapshot(work, {
      base,
      candidate: { ...recordSnapshot(base), text, source },
      source: 'author'
    });
    report.revisions.push({
      kind: 'record',
      id: base.id,
      previousRevisionId: base.revisionId,
      revisionId: saved.revisionId
    });
  }
  for (const base of work.listRelations()) {
    if (pending.has(base.id)) continue;
    const snapshot = relationSnapshot(base);
    let changed = false;
    if (targets.get(base.id)?.kind === 'relation') {
      snapshot.type = replace(base.id, 'type', base.type);
      snapshot.titles = [
        replace(base.id, 'firstTitle', base.titles[0]),
        replace(base.id, 'secondTitle', base.titles[1])
      ];
      changed = snapshot.type !== base.type || snapshot.titles.some((value, index) => value !== base.titles[index]);
    }
    snapshot.milestones = snapshot.milestones.map(milestone => {
      const source = advance(milestone.source);
      if (source === milestone.source) return milestone;
      changed = true;
      return { ...milestone, source };
    });
    if (!changed) continue;
    const saved = applyRelationSnapshot(work, { base, candidate: snapshot, source: 'author' });
    report.revisions.push({
      kind: 'relation',
      id: base.id,
      previousRevisionId: base.revisionId,
      revisionId: saved.revisionId
    });
  }
  return report;
}

/**
 * 在调用方的作品事务中把一次替换改过的对象还原成替换前的文字与出处，各生成一条新修订。
 * 替换之后又变过、或已不在正式内容里的对象保持现状，列入 skipped。
 */
export function undoReplaceText(repository: CreationRepository, input: UndoReplaceTextInput): UndoReplaceTextReport {
  const work = repository.work(input.workId);
  const report: UndoReplaceTextReport = { count: 0, skipped: [] };
  for (const { kind, id, revisionId, previousRevisionId } of input.revisions) {
    if (kind === 'entry') {
      const document = work.getDocument(id);
      if (document?.revisionId !== revisionId) {
        report.skipped.push(id);
        continue;
      }
      saveDocument(work, {
        commandId: input.commandId,
        workId: input.workId,
        documentId: id,
        expectedRevisionId: revisionId,
        title: document.title,
        format: document.format,
        content: work.getRevision(previousRevisionId)!.snapshot.content!
      });
    } else if (kind === 'record') {
      const base = work.getRecord(id);
      if (base?.revisionId !== revisionId) {
        report.skipped.push(id);
        continue;
      }
      const { text, source } = work.getRecordSnapshot(previousRevisionId)!;
      applyRecordSnapshot(work, { base, candidate: { ...recordSnapshot(base), text, source }, source: 'author' });
    } else {
      const base = work.getRelation(id);
      if (base?.revisionId !== revisionId) {
        report.skipped.push(id);
        continue;
      }
      const { type, titles, milestones } = work.getRelationSnapshot(previousRevisionId)!;
      applyRelationSnapshot(work, {
        base,
        candidate: { ...relationSnapshot(base), type, titles, milestones },
        source: 'author'
      });
    }
    report.count++;
  }
  return report;
}
