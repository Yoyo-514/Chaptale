import type { ChatMessage } from '@chaptale/shared';
import type { ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';
import { describe, expect, it } from 'vitest';

import { buildDisplayMessagesFromEntries } from '../branching';

function messageEntry(
  id: string,
  parentId: string | null,
  timestamp: string,
  message: ChatMessage
): Extract<ChaptaleSessionTreeEntry, { type: 'message' }> {
  return {
    type: 'message',
    id,
    parentId,
    timestamp,
    message
  };
}

describe('buildDisplayMessagesFromEntries', () => {
  it('filters empty assistant messages that have no rendered content', () => {
    const entries: ChaptaleSessionTreeEntry[] = [
      messageEntry('user-a', null, '2026-07-01T00:00:01.000Z', {
        role: 'user',
        content: '问题'
      }),
      messageEntry('assistant-empty', 'user-a', '2026-07-01T00:00:02.000Z', {
        role: 'assistant',
        content: []
      })
    ];

    expect(buildDisplayMessagesFromEntries(entries, 'assistant-empty').map(message => message.entryId)).toEqual([
      'user-a'
    ]);
  });

  it('builds current branch and user branch navigation from pi entry parent ids', () => {
    const entries: ChaptaleSessionTreeEntry[] = [
      {
        type: 'session_info',
        id: 'root',
        parentId: null,
        timestamp: '2026-07-01T00:00:00.000Z',
        name: '默认会话'
      },
      messageEntry('user-a', 'root', '2026-07-01T00:00:01.000Z', {
        role: 'user',
        content: '原问题'
      }),
      messageEntry('assistant-a', 'user-a', '2026-07-01T00:00:02.000Z', {
        role: 'assistant',
        content: [{ type: 'text', text: '原回答' }]
      }),
      messageEntry('user-b', 'root', '2026-07-01T00:00:03.000Z', {
        role: 'user',
        content: '编辑后的问题'
      }),
      messageEntry('assistant-b', 'user-b', '2026-07-01T00:00:04.000Z', {
        role: 'assistant',
        content: [{ type: 'text', text: '新回答' }]
      })
    ];

    const messages = buildDisplayMessagesFromEntries(entries, 'assistant-b');

    expect(messages.map(message => message.entryId)).toEqual(['user-b', 'assistant-b']);
    expect(messages[0].branch).toEqual({
      current: 2,
      total: 2,
      previousLeafId: 'assistant-a',
      nextLeafId: undefined
    });
  });

  it('attaches the pending compaction to the next renderable message', () => {
    const entries: ChaptaleSessionTreeEntry[] = [
      messageEntry('user-a', null, '2026-07-11T00:00:01.000Z', { role: 'user', content: '第一个问题' }),
      messageEntry('assistant-a', 'user-a', '2026-07-11T00:00:02.000Z', {
        role: 'assistant',
        content: [{ type: 'text', text: '第一个回答' }]
      }),
      {
        type: 'compaction',
        id: 'compaction-1',
        parentId: 'assistant-a',
        timestamp: '2026-07-11T00:00:03.000Z',
        summary: '早期讨论摘要',
        firstKeptEntryId: 'assistant-a',
        tokensBefore: 12000
      },
      messageEntry('assistant-empty', 'compaction-1', '2026-07-11T00:00:04.000Z', {
        role: 'assistant',
        content: []
      }),
      messageEntry('user-b', 'assistant-empty', '2026-07-11T00:00:05.000Z', { role: 'user', content: '继续' })
    ];

    const messages = buildDisplayMessagesFromEntries(entries, 'user-b');

    expect(messages.map(message => message.entryId)).toEqual(['user-a', 'assistant-a', 'user-b']);
    expect(messages[0].compactionBefore).toBeUndefined();
    expect(messages[1].compactionBefore).toBeUndefined();
    expect(messages[2].compactionBefore).toEqual({ summary: '早期讨论摘要', tokensBefore: 12000 });
  });
});
