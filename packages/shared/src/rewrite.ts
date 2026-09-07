import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import type { ReviewIssue } from './reviews';
import { applyDocumentEdits, normalizeDocumentText } from './writing';

export const RewriteEditsSchema = Type.Array(
  Type.Object(
    {
      original: Type.String({ minLength: 1, maxLength: 100_000 }),
      replacement: Type.String({ maxLength: 200_000 }),
      rationale: Type.String({ minLength: 1, maxLength: 5000 })
    },
    { additionalProperties: false }
  ),
  { minItems: 1, maxItems: 100 }
);
export const RewriteEditsValidator = Compile(RewriteEditsSchema);
export type RewriteEdit = Static<typeof RewriteEditsSchema>[number];
export type RewriteSpan = { from: number; to: number; text: string };

/** 定位高亮可以宽容，修改授权必须基于精确原文。 */
export function rewriteSpans(content: string, issues: readonly ReviewIssue[], bodyStart = 0): RewriteSpan[] {
  const text = normalizeDocumentText(content);
  if (!issues.length) throw new Error('请选择未处理的问题');
  const spans = issues.map(issue => {
    const quote = normalizeDocumentText(issue.quote);
    let from = text.indexOf(quote);
    if (!quote || from < 0) throw new Error('问题原文已失锚，请重新审查');
    if (text.indexOf(quote, from + 1) >= 0) {
      const position = issue.position?.start;
      if (position === undefined || text.slice(position, position + quote.length) !== quote)
        throw new Error('问题原文有歧义，请重新审查');
      from = position;
    }
    if (from < bodyStart) throw new Error('修订不能修改 frontmatter');
    const start = text.lastIndexOf('\n', from - 1) + 1;
    const end = text.indexOf('\n', from + quote.length - 1);
    return { from: start, to: end < 0 ? text.length : end };
  });
  // oxlint-disable-next-line unicorn/no-array-sort
  spans.sort((a, b) => a.from - b.from);
  const merged: RewriteSpan[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span.from <= previous.to) {
      previous.to = Math.max(previous.to, span.to);
      previous.text = text.slice(previous.from, previous.to);
    } else merged.push({ ...span, text: text.slice(span.from, span.to) });
  }
  return merged;
}

export function applyRewriteEdits(content: string, edits: unknown, spans: readonly RewriteSpan[]) {
  if (!RewriteEditsValidator.Check(edits)) throw new Error('修订输出不符合替换协议');
  const text = normalizeDocumentText(content);
  const replacements = edits.map(edit => {
    const original = normalizeDocumentText(edit.original);
    const replacement = normalizeDocumentText(edit.replacement);
    if (!original || original === replacement) throw new Error('修订没有有效改动');
    const matches: number[] = [];
    for (const span of spans) {
      if (text.slice(span.from, span.to) !== span.text) throw new Error('允许修改的原文已变化');
      let from = text.indexOf(original, span.from);
      while (from >= 0 && from + original.length <= span.to) {
        matches.push(from);
        from = text.indexOf(original, from + 1);
      }
    }
    if (matches.length !== 1) throw new Error('修订原文失锚、存在歧义或超出选中问题范围');
    return { from: matches[0]!, to: matches[0]! + original.length, insert: replacement };
  });
  // 使用原始字节投影，仅替换触及的文字；不重新序列化全文或未变行。
  return applyDocumentEdits(content, replacements);
}
