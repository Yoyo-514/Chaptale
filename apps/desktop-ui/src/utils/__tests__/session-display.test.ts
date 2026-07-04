import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import { describe, expect, it } from 'vitest';

import { getSessionTitle } from '../session-display';

function createSession(overrides: Partial<ChaptaleSessionListItem>): ChaptaleSessionListItem {
  return {
    id: 'session-1',
    name: undefined,
    cwd: 'E:/backend-study/Chaptale',
    path: 'E:/backend-study/Chaptale/.chaptale/session.jsonl',
    messageCount: 0,
    lastMessagePreview: undefined,
    leafId: null,
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    ...overrides
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
});
