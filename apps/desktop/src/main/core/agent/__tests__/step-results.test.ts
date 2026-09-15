import { describe, expect, it } from 'vitest';

import { toPersistedStep, withPairedToolResults } from '../step-results';
import type { AgentStepOutcome } from '../types';

function outcome(overrides: Partial<AgentStepOutcome> = {}): AgentStepOutcome {
  return {
    text: '',
    reasoning: '',
    toolCalls: [],
    toolResults: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    finishReason: 'stop',
    aborted: false,
    error: undefined,
    responseMessages: [],
    ...overrides
  };
}

describe('单步结果投影', () => {
  it('空步骤不产生记录，半截正文仍可回放', () => {
    expect(toPersistedStep(outcome())).toEqual([]);
    expect(toPersistedStep(outcome({ text: '雨还没停', error: new Error('连接中断') }))).toEqual([
      expect.objectContaining({ role: 'assistant', content: '雨还没停' })
    ]);
  });

  it('取消优先于截断，补位结果如实保留中断标记', () => {
    const messages = toPersistedStep(
      outcome({
        toolCalls: [{ id: 'write-1', name: 'write', arguments: { path: 'chapter.md' } }],
        aborted: true,
        finishReason: 'length'
      })
    );
    expect(messages[1]).toMatchObject({ role: 'tool', toolCallId: 'write-1', interrupted: true, isError: true });
  });

  it('续跑保留原始推理签名，只补未配对的工具结果', () => {
    const responseMessages: AgentStepOutcome['responseMessages'] = [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '分析', providerOptions: { anthropic: { signature: 'original-signature' } } },
          { type: 'tool-call', toolCallId: 'read-1', toolName: 'read', input: { path: 'chapter.md' } }
        ]
      }
    ];
    const step = outcome({
      toolCalls: [{ id: 'read-1', name: 'read', arguments: { path: 'chapter.md' } }],
      toolResults: [{ toolCallId: 'read-1', toolName: 'read', output: '正文', isError: false }],
      responseMessages
    });
    const paired = withPairedToolResults(step);
    expect(paired[0]).toBe(responseMessages[0]);
    expect(paired).toHaveLength(2);
    expect(paired[1]).toMatchObject({
      role: 'tool',
      content: [expect.objectContaining({ toolCallId: 'read-1', toolName: 'read' })]
    });
    expect(withPairedToolResults({ ...step, responseMessages: paired })).toBe(paired);
  });
});
