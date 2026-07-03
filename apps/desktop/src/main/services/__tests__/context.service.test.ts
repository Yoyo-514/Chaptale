import type { ChatMessage } from '@chaptale/shared';
import { describe, expect, it } from 'vitest';

import { ContextService, type SessionMessageStore } from '../context.service';

function createSessionStore(): SessionMessageStore {
  const messages: ChatMessage[] = [];

  return {
    ensureDefaultSession: async () => ({ id: 'test-session' }),
    getMessages: async () => messages,
    appendMessage: async (_sessionId, message) => {
      messages.push(message);
    }
  };
}

describe('ContextService', () => {
  it('returns configured prompts', () => {
    const service = new ContextService(createSessionStore());

    expect(service.getSystemPrompt()).toContain('云汐');
    expect(service.getChaptaleSystemPrompt()).toContain('Chaptale');
  });

  it('stores messages in insertion order', async () => {
    const service = new ContextService(createSessionStore());

    await service.push({
      type: 'user',
      payload: {
        content: '你好'
      }
    });

    await service.push({
      type: 'assistant',
      payload: {
        content: '你好喵'
      }
    });

    await expect(service.getMessages()).resolves.toEqual([
      {
        type: 'user',
        payload: {
          content: '你好'
        }
      },
      {
        type: 'assistant',
        payload: {
          content: '你好喵'
        }
      }
    ]);
  });
});
