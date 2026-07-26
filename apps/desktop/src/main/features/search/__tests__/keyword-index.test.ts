import { describe, expect, it } from 'vitest';

import { KeywordIndex } from '../keyword-index';
import { IntlSegmenterTermTokenizer } from '../term-tokenizer';
import type { IndexChunk } from '../types';

function chunk(id: string, overrides: Partial<IndexChunk>): IndexChunk {
  return {
    id,
    sourcePath: `角色/${id}.md`,
    domain: 'canon',
    role: 'characters',
    title: '无关标题',
    headingPath: [],
    ordinal: 0,
    startOffset: 0,
    endOffset: 2,
    body: '无关正文',
    pinyin: '',
    ...overrides
  };
}

describe('KeywordIndex', () => {
  const tokenizer = new IntlSegmenterTermTokenizer();

  it('标题命中的权重高于正文命中', () => {
    const index = KeywordIndex.create([chunk('title', { title: '林晚' }), chunk('body', { body: '林晚' })], tokenizer);

    const results = index.search('林晚');

    expect(results.map(result => result.chunkId)).toEqual(['title', 'body']);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('支持 domain 过滤与拼音字段', () => {
    const index = KeywordIndex.create(
      [
        chunk('canon', { pinyin: 'lin wan linwan lw' }),
        chunk('notes', { domain: 'notes', role: 'notes', pinyin: 'lin wan linwan lw' })
      ],
      tokenizer
    );

    const results = index.search('linwan', { domains: ['notes'] });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ chunkId: 'notes', domain: 'notes', matchedTerms: ['linwan'] });
  });

  it('序列化后可用相同 tokenizer 恢复', () => {
    const chunks = [chunk('one', { title: '机械师公会' })];
    const restored = KeywordIndex.load(KeywordIndex.create(chunks, tokenizer).serialize(), chunks, tokenizer);

    expect(restored.search('机械师公会')[0].chunkId).toBe('one');
  });
});
