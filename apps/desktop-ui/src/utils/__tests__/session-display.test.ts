import { describe, expect, it } from 'vitest';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { formatSessionTime, formatTokenCount, getSessionTitle } from '../session-display';

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
    totalTokens: 0,
    ...overrides
  };

  return {
    ...session,
    totalTokens: session.totalTokens ?? 0
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

  it('formats updated time for list display', () => {
    expect(formatSessionTime('2026-07-04T08:05:00.000Z')).toMatch(/\d{2}\/\d{2}.*\d{2}:\d{2}/);
  });

  it('formats token summaries with compact user-readable units', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(12_300)).toBe('12.3K');
    expect(formatTokenCount(1_200_000)).toBe('1.2M');
  });
});
