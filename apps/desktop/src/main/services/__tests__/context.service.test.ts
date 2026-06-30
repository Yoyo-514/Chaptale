import { describe, expect, it } from 'vitest';

import { ContextService } from '../context.service';

describe('ContextService', () => {
  it('returns configured prompts', () => {
    const service = new ContextService();

    expect(service.getSystemPrompt()).toContain('云汐');
    expect(service.getChaptaleSystemPrompt()).toContain('Chaptale');
  });

  it('stores messages in insertion order', () => {
    const service = new ContextService();

    service.push({
      type: 'user',
      payload: {
        content: '你好'
      }
    });

    service.push({
      type: 'assistant',
      payload: {
        content: '你好喵'
      }
    });

    expect(service.getMessages()).toEqual([
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
