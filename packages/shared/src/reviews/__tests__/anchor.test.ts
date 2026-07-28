import { describe, expect, it } from 'vitest';

import * as shared from '@chaptale/shared';
import type { ReviewIssue } from '@chaptale/shared';

type ReviewPosition = NonNullable<ReviewIssue['position']>;
type ResolveReviewAnchor = (text: string, issue: ReviewIssue) => unknown;

function issue(quote: string, position?: ReviewPosition): ReviewIssue {
  return {
    agentType: 'continuity',
    severity: 'medium',
    type: 'timeline',
    quote,
    reason: '用于测试 anchor 定位。',
    suggestion: '保持定位稳定。',
    ...(position ? { position } : {})
  };
}

describe('resolveReviewAnchor', () => {
  it('唯一 exact 命中时返回 exact anchor', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('甲乙丙', issue('乙'))).toEqual({
      stale: false,
      start: 1,
      end: 2,
      strategy: 'exact'
    });
  });

  it('多处 exact 命中且存在有效 position.start 时返回 nearest', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('同句 A；同句 B', issue('同句', { start: 6 }))).toEqual({
      stale: false,
      start: 5,
      end: 7,
      strategy: 'nearest'
    });
  });

  it('多处 exact 命中但 position.start 无效时返回 ambiguous', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('重复 重复', issue('重复', { start: 1.5 } as ReviewPosition))).toEqual({
      stale: true,
      reason: 'ambiguous'
    });
  });

  it('无 position 时多候选必须返回 ambiguous', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('重复 重复', issue('重复'))).toEqual({
      stale: true,
      reason: 'ambiguous'
    });
  });

  it('normalized 匹配采用 NFKC、空白折叠与中英文标点等价，并还原原始 offset', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('前缀 他说：“你好，世界。” 后缀', issue('他说: "你好, 世界。"'))).toEqual({
      stale: false,
      start: 3,
      end: 14,
      strategy: 'normalized'
    });
  });

  it('normalized 匹配在 astral 前缀下仍还原正确原文 offset', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('😀前缀 他说：“你好，世界。” 后缀', issue('他说: "你好, 世界。"'))).toEqual({
      stale: false,
      start: 5,
      end: 16,
      strategy: 'normalized'
    });
  });

  it('normalized 多候选时复用原文 start 最近策略', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(
      resolveReviewAnchor('甲说：“你好，世界。”\n乙说：“你好，世界。”', issue('说: "你好, 世界。"', { start: 14 }))
    ).toEqual({
      stale: false,
      start: 13,
      end: 23,
      strategy: 'normalized'
    });
  });

  it('normalized 多候选时最近距离不唯一则返回 ambiguous', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(
      resolveReviewAnchor('甲说：“你好，世界。”\n乙说：“你好，世界。”', issue('说: "你好, 世界。"', { start: 7 }))
    ).toEqual({
      stale: true,
      reason: 'ambiguous'
    });
  });

  it('quote 为脏值时不抛异常并返回 not-found', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;
    const dirtyIssues = [issue(undefined as any), issue(null as any), issue('' as any), issue(123 as any)];

    for (const dirtyIssue of dirtyIssues) {
      expect(resolveReviewAnchor('任意文本', dirtyIssue)).toEqual({
        stale: true,
        reason: 'not-found'
      });
    }
  });

  it('只删除紧邻已注册标点或引号的折叠空格，不删除普通词间空格', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('前缀 他说：“你好，世界。” 后缀', issue('他说: "你好, 世界。"'))).toEqual({
      stale: false,
      start: 3,
      end: 14,
      strategy: 'normalized'
    });

    expect(resolveReviewAnchor('保留 普通 空格', issue('保留普通空格'))).toEqual({
      stale: true,
      reason: 'not-found'
    });
  });

  it('normalized 命中结束于折叠空白时返回最后一个原文空白的 end offset', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('甲\t \n尾', issue('甲 '))).toEqual({
      stale: false,
      start: 0,
      end: 4,
      strategy: 'normalized'
    });
  });

  it('找不到 quote 时返回 not-found', () => {
    const resolveReviewAnchor = (shared as { resolveReviewAnchor?: ResolveReviewAnchor }).resolveReviewAnchor!;

    expect(resolveReviewAnchor('已经修改', issue('原始句子'))).toEqual({
      stale: true,
      reason: 'not-found'
    });
  });
});
