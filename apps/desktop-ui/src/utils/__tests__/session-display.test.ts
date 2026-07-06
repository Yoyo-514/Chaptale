import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import { describe, expect, it } from 'vitest';

import {
  formatSessionCost,
  formatSessionScope,
  formatSessionTime,
  formatTokenCount,
  getSessionTitle
} from '../session-display';

function createSession(overrides: Partial<ChaptaleSessionListItem>): ChaptaleSessionListItem {
  const session = {
    id: 'session-1',
    name: undefined,
    cwd: 'E:/backend-study/Chaptale',
    path: 'E:/backend-study/Chaptale/.chaptale/session.jsonl',
    messageCount: 0,
    lastMessagePreview: undefined,
    leafId: null,
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    scope: 'global' as const,
    totalTokens: 0,
    totalCost: 0,
    ...overrides
  };

  return {
    ...session,
    scope: session.scope ?? 'global',
    totalTokens: session.totalTokens ?? 0,
    totalCost: session.totalCost ?? 0
  };
}

describe('session-display', () => {
  it('prefers explicit session name', () => {
    expect(getSessionTitle(createSession({ name: '项目讨论', lastMessagePreview: 'hello' }))).toBe('项目讨论');
  });

  it('falls back to last message preview and unnamed label', () => {
    expect(getSessionTitle(createSession({ lastMessagePreview: '第一条消息' }))).toBe('第一条消息');
    expect(getSessionTitle(createSession({}))).toBe('未命名会话');
  });

  it('formats session scope and updated time for list display', () => {
    expect(formatSessionScope('global')).toBe('全局');
    expect(formatSessionScope('workspace')).toBe('工作区');
    expect(formatSessionTime('2026-07-04T08:05:00.000Z')).toMatch(/\d{2}\/\d{2}.*\d{2}:\d{2}/);
  });

  it('formats token and cost summaries with compact user-readable units', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(12_300)).toBe('12.3K');
    expect(formatTokenCount(1_200_000)).toBe('1.2M');
    expect(formatSessionCost(0)).toBe('$0');
    expect(formatSessionCost(0.005)).toBe('<$0.01');
    expect(formatSessionCost(1.234)).toBe('$1.23');
  });
});
