import { describe, expect, it } from 'vitest';

import { buildMemoryInjectionBlock } from '../injection-block';

describe('buildMemoryInjectionBlock', () => {
  it('returns undefined for empty sections', () => {
    expect(buildMemoryInjectionBlock({})).toBeUndefined();
  });

  it('wraps sections in a memory envelope with style guide first', () => {
    const block = buildMemoryInjectionBlock({
      preferences: '- 喜欢短句',
      styleGuide: '禁用词：xxx'
    });

    expect(block).toMatch(/^<memory[^>]*>\n/);
    expect(block).toMatch(/\n<\/memory>$/);
    expect(block!.indexOf('创作守则与禁忌')).toBeLessThan(block!.indexOf('作者偏好要点'));
  });

  it('drops lower-priority sections over budget and appends read hints', () => {
    const block = buildMemoryInjectionBlock(
      {
        styleGuide: '短守则',
        notes: 'x'.repeat(4000)
      },
      100
    );

    expect(block).toContain('短守则');
    expect(block).not.toContain('xxxx');
    expect(block).toContain('笔记清单未注入');
  });

  it('is deterministic for identical inputs', () => {
    const sections = { preferences: 'a', recent: 'b' };

    expect(buildMemoryInjectionBlock(sections)).toBe(buildMemoryInjectionBlock(sections));
  });
});
