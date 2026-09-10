import { describe, expect, it } from 'vitest';

import { START_GUIDE_PROMPT, shouldOfferStartGuide } from '../useStartGuide';

const offered = { hasWorkspace: true, isChapter: true, words: 0, hasStarted: false };

describe('第一步提示的出现条件', () => {
  it('作品已建好、当前是空章节且这个作品还没有开始过时出现', () => {
    expect(shouldOfferStartGuide(offered)).toBe(true);
  });
  it('缺少任一前提都不出现', () => {
    expect(shouldOfferStartGuide({ ...offered, hasWorkspace: false })).toBe(false);
    expect(shouldOfferStartGuide({ ...offered, isChapter: false })).toBe(false);
    expect(shouldOfferStartGuide({ ...offered, words: 1 })).toBe(false);
    expect(shouldOfferStartGuide({ ...offered, hasStarted: true })).toBe(false);
  });
});

describe('起手话术', () => {
  it('以作者本人的口吻开场，把「理清楚」具体到蓝图四轮', () => {
    expect(START_GUIDE_PROMPT).toContain('我要写：');
    expect(START_GUIDE_PROMPT).toContain('暂时不用动笔');
    expect(START_GUIDE_PROMPT).toContain('核心冲突');
    // 留一处空行给作者补自己的想法，否则访谈会从零问起。
    expect(START_GUIDE_PROMPT).toContain('______');
  });
  it('不把作者描述成新手', () => {
    expect(START_GUIDE_PROMPT).not.toMatch(/新手|刚开始写|小白/);
  });
});
