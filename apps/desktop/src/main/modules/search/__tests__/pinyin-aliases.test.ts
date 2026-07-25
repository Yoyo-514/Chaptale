import { describe, expect, it } from 'vitest';

import { buildPinyinAliases } from '../pinyin-aliases';

describe('buildPinyinAliases', () => {
  it('生成分隔全拼、连续全拼和首字母', () => {
    expect(buildPinyinAliases('林晚')).toEqual(expect.arrayContaining(['lin wan', 'linwan', 'lw']));
  });

  it('角色名启用姓氏头部读音', () => {
    expect(buildPinyinAliases('解雨臣', { surnameAtHead: true })).toContain('xieyuchen');
  });

  it('单字只保留有限多音候选并合并显式别名', () => {
    const aliases = buildPinyinAliases('长', { explicitAliases: ['  Zhang ', 'CHANG'] });

    expect(aliases).toEqual(expect.arrayContaining(['chang', 'zhang']));
    expect(aliases.filter(alias => alias === 'chang')).toHaveLength(1);
    expect(aliases.length).toBeLessThanOrEqual(4);
  });
});
