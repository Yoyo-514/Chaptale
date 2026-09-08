import { describe, expect, it } from 'vitest';

import { findTextMatches } from '../text-search';

describe('workspace text search', () => {
  it('locates repeated CJK text with normalized CRLF and UTF-16 offsets', () => {
    const content = '# 章节\r\n初雪。初雪\r\n终章';
    expect(findTextMatches(content, '初雪', true, 10).map(({ line, from, to }) => ({ line, from, to }))).toEqual([
      { line: 2, from: 5, to: 7 },
      { line: 2, from: 8, to: 10 }
    ]);
  });
  it('treats regular-expression punctuation literally and respects case', () => {
    expect(findTextMatches('Ab.* ab.*', 'ab.*', false, 10)).toHaveLength(2);
    expect(findTextMatches('Ab.* ab.*', 'ab.*', true, 10)).toHaveLength(1);
  });
  it('bounds results and keeps the match visible on long lines', () => {
    expect(findTextMatches('a'.repeat(10000), 'a', false, 2)).toHaveLength(2);
    const [match] = findTextMatches(`${'x'.repeat(1000)}目标${'y'.repeat(1000)}`, '目标', false, 10);
    expect(match?.before).toHaveLength(55);
    expect(match?.after).toHaveLength(90);
    expect(findTextMatches('abc', '', false, 10)).toEqual([]);
    expect(findTextMatches('abc', 'a', false, 0)).toEqual([]);
  });
});
