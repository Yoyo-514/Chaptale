import { marked, type Token } from 'marked';
import { createHash } from 'node:crypto';

import { estimateTextTokens, takeTextTailToTokenBudget, takeTextToTokenBudget } from '../../core/context/token-counter';
import { buildPinyinAliases } from './pinyin-aliases';
import type { IndexChunk, IndexSourceDocument } from './types';

export type MarkdownChunkOptions = {
  maxTokens?: number;
  overlapTokens?: number;
};

type Section = {
  start: number;
  end: number;
  headingPath: string[];
};

const DEFAULT_MAX_TOKENS = 1_000;
const DEFAULT_OVERLAP_TOKENS = 200;

/**
 * heading section 是第一层边界；超长 section 优先在 Marked block、句子和标点处断开。
 * offset 始终指向 frontmatter 解析后的 body，overlap 通过回退 start 形成，不复制或改写原文。
 */
export function chunkMarkdownDocument(document: IndexSourceDocument, options: MarkdownChunkOptions = {}): IndexChunk[] {
  const maxTokens = positiveInteger(options.maxTokens, DEFAULT_MAX_TOKENS);
  const overlapTokens = Math.min(
    Math.max(0, Math.floor(options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS)),
    Math.floor(maxTokens / 2)
  );
  const drafts: IndexChunk[] = [];

  for (const section of findSections(document.body)) {
    const heading = section.headingPath.join(' / ');
    const headingTokens = heading ? estimateTextTokens(`${heading}\n`) : 0;
    const bodyBudget = Math.max(1, maxTokens - headingTokens);
    let start = section.start;

    while (start < section.end) {
      const remaining = document.body.slice(start, section.end);
      const bounded = takeTextToTokenBudget(remaining, bodyBudget).head;
      if (!bounded) break;
      const maxEnd = start + bounded.length;
      const end = maxEnd >= section.end ? section.end : chooseSemanticBoundary(document.body, start, maxEnd);
      const body = document.body.slice(start, end);
      const ordinal = drafts.length;
      const id = createChunkId(document.sourcePath, ordinal, start, end, body);
      drafts.push({
        id,
        sourcePath: document.sourcePath,
        domain: document.domain,
        role: document.role,
        title: document.title,
        ...(document.kind ? { kind: document.kind } : {}),
        headingPath: [...section.headingPath],
        ordinal,
        startOffset: start,
        endOffset: end,
        body,
        pinyin: [
          ...new Set(
            [document.title, ...section.headingPath].flatMap(value =>
              buildPinyinAliases(value, {
                surnameAtHead: document.kind === 'character',
                explicitAliases: [...document.aliases, ...document.searchAliases]
              })
            )
          )
        ].join(' ')
      });

      if (end >= section.end) break;
      const overlap = takeTextTailToTokenBudget(body, overlapTokens).tail;
      const overlappedStart = end - overlap.length;
      start = overlappedStart > start ? overlappedStart : end;
    }
  }

  // drafts 是本函数独占的新对象；原地补链可避免为每个 chunk 再分配一次完整副本。
  for (let index = 0; index < drafts.length; index += 1) {
    if (index > 0) drafts[index].previousId = drafts[index - 1].id;
    if (index < drafts.length - 1) drafts[index].nextId = drafts[index + 1].id;
  }
  return drafts;
}

/** Marked token.raw 按原文顺序定位，保留稳定 offset，而不是对渲染后的 Markdown 反推位置。 */
function findSections(body: string): Section[] {
  const sections: Section[] = [];
  const headings: string[] = [];
  let cursor = 0;
  let sectionStart = 0;

  for (const token of marked.lexer(body)) {
    const tokenStart = locateToken(body, token, cursor);
    const tokenEnd = tokenStart + token.raw.length;
    if (token.type === 'heading') {
      pushSection(sections, body, sectionStart, tokenStart, headings);
      const depth = token.depth;
      headings.length = Math.min(headings.length, depth - 1);
      headings[depth - 1] = token.text.trim();
      sectionStart = tokenEnd;
    }
    cursor = tokenEnd;
  }

  pushSection(sections, body, sectionStart, body.length, headings);
  return sections;
}

function pushSection(sections: Section[], body: string, start: number, end: number, headings: string[]): void {
  while (start < end && /\s/u.test(body[start])) start += 1;
  while (end > start && /\s/u.test(body[end - 1])) end -= 1;
  if (start < end) sections.push({ start, end, headingPath: [...headings] });
}

function locateToken(body: string, token: Token, cursor: number): number {
  const located = body.indexOf(token.raw, cursor);
  return located >= 0 ? located : cursor;
}

function chooseSemanticBoundary(body: string, start: number, maxEnd: number): number {
  const window = body.slice(start, maxEnd);
  const candidates = new Set<number>();

  let tokenCursor = 0;
  for (const token of marked.lexer(window)) {
    const tokenStart = locateToken(window, token, tokenCursor);
    tokenCursor = tokenStart + token.raw.length;
    if (tokenCursor > 0 && tokenCursor <= window.length) candidates.add(start + tokenCursor);
  }

  const sentenceSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' });
  for (const segment of sentenceSegmenter.segment(window)) {
    const end = segment.index + segment.segment.length;
    if (end > 0 && end <= window.length) candidates.add(start + end);
  }

  for (const match of window.matchAll(/[\n。！？!?；;]+/gu)) {
    candidates.add(start + (match.index ?? 0) + match[0].length);
  }

  const useful = [...candidates]
    .filter(candidate => candidate > start && candidate <= maxEnd)
    .toSorted((a, b) => b - a);
  return useful[0] ?? maxEnd;
}

function createChunkId(sourcePath: string, ordinal: number, start: number, end: number, body: string): string {
  return createHash('sha256').update(`${sourcePath}\0${ordinal}\0${start}\0${end}\0${body}`).digest('hex').slice(0, 24);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const normalized = Math.floor(value ?? fallback);
  return normalized > 0 ? normalized : fallback;
}
