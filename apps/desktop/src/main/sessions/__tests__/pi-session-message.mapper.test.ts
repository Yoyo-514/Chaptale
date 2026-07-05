import { describe, expect, it } from 'vitest';

import { fromPiMessage } from '../pi-session-message.mapper';

describe('pi-session-message.mapper', () => {
  it('maps empty pi error assistant messages to system errors', () => {
    expect(
      fromPiMessage({
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: '403 Your request was blocked.'
      })
    ).toEqual({
      type: 'system',
      payload: { content: '403 Your request was blocked.' }
    });
  });

  it('ignores empty assistant messages without text, reasoning or errors', () => {
    expect(
      fromPiMessage({
        role: 'assistant',
        content: []
      })
    ).toBeUndefined();
  });

  it('maps pi thinking content blocks to assistant reasoning', () => {
    expect(
      fromPiMessage({
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: '分析问题',
            thinkingSignature: 'reasoning_content'
          },
          {
            type: 'text',
            text: '最终回答'
          }
        ]
      })
    ).toEqual({
      type: 'assistant',
      payload: {
        content: '最终回答',
        reasoning: '分析问题',
        reasoningStatus: 'done'
      }
    });
  });
});
