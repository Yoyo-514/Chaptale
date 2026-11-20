import type { Entry, TextMatch, TextSearchInput, TextSearchResult } from '../contracts/index.ts';
import type { WorkRepository } from '../repository.ts';

/** 一次搜索最多返回的命中数；超出的只计入 total。 */
export const textMatchLimit = 2000;
/** 命中前后各带多少字，够在结果列表里认出这一处。 */
const excerptBefore = 16;
const excerptLength = 96;

const wordCharacter = /[\p{L}\p{N}_]/u;
const isWord = (character: string | undefined) => character !== undefined && wordCharacter.test(character);
/** 位置前后的那个字；扩展区汉字占两个码元，按一个字取。 */
const characterAt = (line: string, index: number) =>
  index < line.length ? String.fromCodePoint(line.codePointAt(index)!) : undefined;
function characterBefore(line: string, index: number) {
  if (index === 0) return undefined;
  const low = line.charCodeAt(index - 1);
  return index > 1 && low >= 0xdc00 && low <= 0xdfff ? line.slice(index - 2, index) : line[index - 1];
}

type TextPattern = Pick<TextSearchInput, 'pattern' | 'caseSensitive' | 'wholeWord' | 'regexp'>;

/** 一处命中：line、from、to 是去掉 BOM 后的行内位置，start、end 是原文里的位置。 */
export interface TextHit {
  line: number;
  from: number;
  to: number;
  start: number;
  end: number;
  lineText: string;
  groups: RegExpExecArray;
}

/**
 * 按搜索选项逐行找出一段文字里的全部命中，搜索和替换都从这里取。命中不跨行，空命中不算；
 * 全词匹配时命中的两端都不能把一个词从中间切开，连写的汉字算一个词。正则写错时报出原因。
 */
export function textScanner({ pattern, caseSensitive, wholeWord, regexp }: TextPattern) {
  const source = regexp ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let expression: RegExp;
  try {
    expression = new RegExp(source, caseSensitive ? 'gu' : 'giu');
  } catch (error) {
    throw new Error(`正则表达式有误：${(error as Error).message}`, { cause: error });
  }
  const splitsWord = (line: string, index: number) =>
    isWord(characterBefore(line, index)) && isWord(characterAt(line, index));
  return function* scan(text: string): Generator<TextHit> {
    let lineStart = text.startsWith('\uFEFF') ? 1 : 0;
    let line = 1;
    for (const ending of [...text.matchAll(/\r\n?|\n/g), null]) {
      const lineText = text.slice(lineStart, ending?.index ?? text.length);
      for (const groups of lineText.matchAll(expression)) {
        const from = groups.index;
        const to = from + groups[0].length;
        if (to === from || (wholeWord && (splitsWord(lineText, from) || splitsWord(lineText, to)))) continue;
        yield { line, from, to, start: lineStart + from, end: lineStart + to, lineText, groups };
      }
      if (ending) lineStart = ending.index + ending[0].length;
      line++;
    }
  };
}

/** 一处命中替换后的文字。正则替换里的 $1、$&、$$ 与文档内替换写法相同，编号超出捕获组时原样保留。 */
export function replacementFor(replacement: string, regexp: boolean, groups: RegExpExecArray): string {
  if (!regexp) return replacement;
  return replacement.replace(/\$(\$|&|[1-9]\d?)/g, (token: string, name: string) => {
    if (name === '$') return '$';
    if (name === '&') return groups[0];
    if (Number(name) < groups.length) return groups[Number(name)] ?? '';
    if (name.length === 2 && Number(name[0]) < groups.length) return (groups[Number(name[0])] ?? '') + name[1];
    return token;
  });
}

/** 目录树先序排列的文档：文稿在前，资料在后。 */
function documentOrder(entries: readonly Entry[]): Entry[] {
  const children = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = `${entry.section}:${entry.parentId ?? ''}`;
    const siblings = children.get(key);
    if (siblings) siblings.push(entry);
    else children.set(key, [entry]);
  }
  const order: Entry[] = [];
  const visit = (section: Entry['section'], parentId: string | null): void => {
    for (const entry of (children.get(`${section}:${parentId ?? ''}`) ?? []).sort((a, b) => a.position - b.position)) {
      if (entry.kind === 'document') order.push(entry);
      else if (entry.kind === 'directory') visit(section, entry.id);
    }
  };
  visit('manuscript', null);
  visit('resource', null);
  return order;
}

/**
 * 作者在一部作品里按字面或正则搜索：文稿和资料的正式正文、事件的文字、关系的类型与两端称呼。
 * unsaved 里的文稿按编辑器当前的文字搜。命中按文稿、资料、事件、关系的顺序返回，最多 textMatchLimit 处。
 */
export function searchText(work: WorkRepository, input: TextSearchInput): TextSearchResult {
  const scan = textScanner(input);
  const unsaved = new Map(input.unsaved.map(item => [item.documentId, item.content]));
  const result: TextSearchResult = {
    targets: [],
    entries: [],
    records: [],
    relations: [],
    total: 0,
    documentCount: 0,
    recordCount: 0,
    truncated: false
  };

  /** 在返回上限内收下这段文字的命中，返回收下的部分。 */
  const collect = (text: string): TextMatch[] => {
    const found: TextMatch[] = [];
    for (const { line, from, to, lineText, groups } of scan(text)) {
      result.total++;
      if (result.total > textMatchLimit) {
        result.truncated = true;
        continue;
      }
      const start = Math.max(0, from - excerptBefore);
      found.push({
        line,
        from,
        to,
        excerpt: lineText.slice(start, start + excerptLength),
        excerptFrom: from - start,
        ...(input.replacement !== null && { replacement: replacementFor(input.replacement, input.regexp, groups) })
      });
    }
    return found;
  };

  for (const entry of documentOrder(work.listEntries())) {
    const content = unsaved.get(entry.id) ?? work.getDocument(entry.id)!.content;
    const before = result.total;
    const matches = collect(content);
    if (result.total > before) {
      result.documentCount++;
      result.targets.push({ kind: 'entry', id: entry.id, revisionId: entry.revisionId });
    }
    if (matches.length) result.entries.push({ entryId: entry.id, matches });
  }
  for (const record of work.listRecords()) {
    const before = result.total;
    const matches = collect(record.text);
    if (result.total > before) {
      result.recordCount++;
      result.targets.push({ kind: 'record', id: record.id, revisionId: record.revisionId });
    }
    if (matches.length) result.records.push({ recordId: record.id, matches });
  }
  for (const relation of work.listRelations()) {
    const fields = [
      ['type', relation.type],
      ['firstTitle', relation.titles[0]],
      ['secondTitle', relation.titles[1]]
    ] as const;
    const before = result.total;
    const matches = fields.flatMap(([field, text]) => collect(text).map(match => ({ ...match, field })));
    if (result.total > before) {
      result.recordCount++;
      result.targets.push({ kind: 'relation', id: relation.id, revisionId: relation.revisionId });
    }
    if (matches.length) result.relations.push({ relationId: relation.id, matches });
  }
  return result;
}
