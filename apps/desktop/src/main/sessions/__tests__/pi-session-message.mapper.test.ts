import { describe, expect, it } from 'vitest';

import { fromPiMessage } from '../pi-session-message.mapper';

describe('pi-session-message.mapper', () => {
  it('maps empty pi error assistant messages to assistant errors', () => {
    expect(
      fromPiMessage({
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: '403 Your request was blocked.'
      })
    ).toEqual({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: '403 Your request was blocked.'
    });
  });

  it('keeps empty assistant messages without text, reasoning or errors as pi-aligned assistant records', () => {
    expect(
      fromPiMessage({
        role: 'assistant',
        content: []
      })
    ).toEqual({
      role: 'assistant',
      content: [],
      stopReason: undefined,
      errorMessage: undefined,
      api: undefined,
      provider: undefined,
      model: undefined,
      responseId: undefined,
      timestamp: undefined
    });
  });

  it('maps pi thinking content blocks to assistant reasoning blocks', () => {
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
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: '分析问题',
          thinkingSignature: 'reasoning_content',
          redacted: undefined
        },
        {
          type: 'text',
          text: '最终回答',
          textSignature: undefined
        }
      ],
      stopReason: undefined,
      errorMessage: undefined,
      api: undefined,
      provider: undefined,
      model: undefined,
      responseId: undefined,
      timestamp: undefined
    });
  });
});
