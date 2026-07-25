import { describe, expect, it } from 'vitest';

import { IntlSegmenterTermTokenizer, normalizeSearchText } from '../term-tokenizer';

describe('IntlSegmenterTermTokenizer', () => {
  it('统一 NFKC、大小写与空白', () => {
    expect(normalizeSearchText('  Ｃhaptale\t林晚  ')).toBe('chaptale 林晚');
  });

  it('保留中文词边界、双字词与 ASCII 词', () => {
    const terms = new IntlSegmenterTermTokenizer().tokenize('林晚加入机械师 Guild42');

    expect(terms).toEqual(expect.arrayContaining(['林晚', '机械', '械师', 'guild42']));
  });
});
