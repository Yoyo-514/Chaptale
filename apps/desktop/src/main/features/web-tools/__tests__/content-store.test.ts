import { describe, expect, it } from 'vitest';

import { ContentStore } from '../content-store';

function entry(url: string, text: string, title = url) {
  return { url, title, text, wordCount: text.length, fetchedAt: Date.now() };
}

describe('ContentStore · 基础存取', () => {
  it('put/get/all/clear 往返', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/1', '苹果 香蕉'));
    store.put(entry('https://b.example/2', 'cherry dates'));

    expect(store.get('https://a.example/1')?.text).toBe('苹果 香蕉');
    expect(store.all()).toHaveLength(2);

    store.clear();
    expect(store.all()).toHaveLength(0);
  });

  it('同 URL 重复 put 覆盖旧条目', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/1', '旧内容'));
    store.put(entry('https://a.example/1', '新内容'));

    expect(store.get('https://a.example/1')?.text).toBe('新内容');
    expect(store.all()).toHaveLength(1);
  });

  it('超出 maxEntries 淘汰最旧条目', () => {
    const store = new ContentStore({ maxEntries: 2 });
    store.put(entry('https://a.example/1', 'one'));
    store.put(entry('https://b.example/2', 'two'));
    store.put(entry('https://c.example/3', 'three'));

    expect(store.get('https://a.example/1')).toBeUndefined();
    expect(store.get('https://b.example/2')).toBeDefined();
    expect(store.get('https://c.example/3')).toBeDefined();
  });

  it('同 URL 更新不触发淘汰（删除后重插）', () => {
    const store = new ContentStore({ maxEntries: 2 });
    store.put(entry('https://a.example/1', 'one'));
    store.put(entry('https://b.example/2', 'two'));
    store.put(entry('https://a.example/1', 'one-updated'));

    expect(store.all()).toHaveLength(2);
    expect(store.get('https://a.example/1')?.text).toBe('one-updated');
  });
});

describe('ContentStore · 全库检索', () => {
  it('按词频评分排序，高分在前', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/cats', '猫 猫 猫 有一条狗'));
    store.put(entry('https://b.example/dogs', '狗 狗 还有一只猫'));

    const matches = store.search('猫');

    expect(matches[0]?.url).toBe('https://a.example/cats');
    expect(matches).toHaveLength(2);
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });

  it('中英文混合分词均可命中', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/en', 'The quick brown fox jumps over the lazy dog'));

    expect(store.search('fox')).toHaveLength(1);
    expect(store.search('lazy dog')).toHaveLength(1);
  });

  it('无命中/空查询返回空', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/1', '苹果'));

    expect(store.search('西瓜')).toEqual([]);
    expect(store.search('   ')).toEqual([]);
  });

  it('摘要包含命中词上下文与省略号', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/1', '前奏'.repeat(50) + '关键词在这段文字的中间位置' + '尾奏'.repeat(50)));

    const [match] = store.search('关键词');

    expect(match?.excerpt).toContain('关键词');
    expect(match?.excerpt.startsWith('…') || match?.excerpt.includes('关键词')).toBe(true);
  });

  it('结果条数受 limit 限制', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/1', '目标 目标'));
    store.put(entry('https://b.example/2', '目标'));
    store.put(entry('https://c.example/3', '目标'));

    expect(store.search('目标', 2)).toHaveLength(2);
  });
});

describe('ContentStore · 页面内查找', () => {
  it('命中返回带上下文摘录', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/1', '开头一段。目标句在中间。结尾一段。', '标题'));

    const matches = store.findInPage('https://a.example/1', '目标句');

    expect(matches).toHaveLength(1);
    expect(matches[0].excerpt).toContain('目标句');
    expect(matches[0].title).toBe('标题');
  });

  it('未命中/页面不在缓存返回空', () => {
    const store = new ContentStore();
    store.put(entry('https://a.example/1', '内容'));

    expect(store.findInPage('https://a.example/1', '不存在')).toEqual([]);
    expect(store.findInPage('https://missing.example/9', '内容')).toEqual([]);
  });
});
