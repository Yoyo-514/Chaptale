import { describe, expect, it, vi } from 'vitest';

import { createSearchTokenizer } from '../jieba-tokenizer';

describe('createSearchTokenizer', () => {
  it('使用 Jieba 搜索模式与 workspace 专名词典', async () => {
    const result = await createSearchTokenizer(['机械师公会']);
    const terms = result.tokenizer.tokenize('林晚加入机械师公会调查灵脉共振');

    expect(result.tokenizer.id).toBe('jieba-search-v1');
    expect(result.diagnostics).toEqual([]);
    expect(terms).toEqual(expect.arrayContaining(['林晚', '机械师公会', '灵脉']));
  });

  it('原生模块加载失败时降级且使用独立 tokenizer id', async () => {
    const result = await createSearchTokenizer([], {
      loadJieba: vi.fn(async () => {
        throw new Error('native unavailable');
      })
    });

    expect(result.tokenizer.id).toBe('intl-bigram-v1');
    expect(result.tokenizer.tokenize('林晚')).toContain('林晚');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'jieba-unavailable' }));
  });
});
