import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@chaptale/shared';

import {
  formatMaybeJson,
  formatToolName,
  formatUnknownToolPayload,
  getAssistantReasoning,
  getAssistantReasoningStatus,
  getAssistantText,
  getMessagePlainText,
  getPrimaryToolCall,
  getUserDisplayText,
  getUserText,
  hasRenderableMessage
} from '../message-content';

describe('message-content', () => {
  it('extracts user, assistant, and reasoning text from structured content', () => {
    const user: Extract<ChatMessage, { role: 'user' }> = {
      role: 'user',
      content: [
        { type: 'text', text: '第一段' },
        {
          type: 'imageAttachment',
          id: 'image-1',
          mimeType: 'image/png',
          originalBytes: 1,
          width: 100,
          height: 80,
          thumbnailDataUrl: 'data:image/png;base64,eA=='
        },
        { type: 'text', text: '第二段' }
      ]
    };
    const assistant: Extract<ChatMessage, { role: 'assistant' }> = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '推理' },
        { type: 'text', text: '答案' }
      ],
      partial: true
    };

    expect(getUserText(user)).toBe('第一段\n第二段');
    expect(getAssistantText(assistant)).toBe('答案');
    expect(getAssistantReasoning(assistant)).toBe('推理');
    expect(getAssistantReasoningStatus(assistant)).toBe('streaming');
    expect(getAssistantReasoningStatus({ ...assistant, partial: false })).toBe('done');
  });

  it('keeps skill display text compact while reconstructing the reusable slash command', () => {
    const user: Extract<ChatMessage, { role: 'user' }> = {
      role: 'user',
      content: '检查第一章',
      skillInvocation: { name: 'review', arguments: '检查第一章' }
    };

    expect(getUserDisplayText(user)).toBe('检查第一章');
    expect(getUserText(user)).toBe('/skill:review 检查第一章');
    expect(getMessagePlainText(user)).toBe('/skill:review 检查第一章');
  });

  it('decides renderability from visible user-facing content', () => {
    expect(hasRenderableMessage({ role: 'user', content: '   ' })).toBe(false);
    expect(hasRenderableMessage({ role: 'assistant', content: [], partial: true })).toBe(true);
    expect(hasRenderableMessage({ role: 'assistant', content: [], errorMessage: 'failed' })).toBe(true);
    expect(
      hasRenderableMessage({
        role: 'assistant',
        content: [],
        retry: { status: 'retrying', attempt: 1, maxAttempts: 3 }
      })
    ).toBe(true);
    expect(
      hasRenderableMessage({
        role: 'toolResult',
        toolCallId: '1',
        toolName: 'x',
        content: [{ type: 'text', text: ' ' }]
      })
    ).toBe(false);
    expect(
      hasRenderableMessage({
        role: 'toolResult',
        toolCallId: '1',
        toolName: 'x',
        content: [{ type: 'text', text: 'done' }]
      })
    ).toBe(true);
  });

  it('uses tool calls and errors as plain-text fallbacks for copy/search', () => {
    const assistant: Extract<ChatMessage, { role: 'assistant' }> = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-1', name: 'web_search', arguments: { query: 'Chaptale' } }]
    };

    expect(getPrimaryToolCall(assistant)?.name).toBe('web_search');
    expect(getMessagePlainText(assistant)).toContain('"query": "Chaptale"');
    expect(getMessagePlainText({ role: 'assistant', content: [], errorMessage: 'AI 回复失败' })).toBe('AI 回复失败');
    expect(
      getMessagePlainText({
        role: 'toolResult',
        toolCallId: '1',
        toolName: 'fetch_content',
        content: [{ type: 'text', text: '网页正文' }]
      })
    ).toBe('网页正文');
  });

  it('formats tool names and unknown payloads for readable UI output', () => {
    expect(formatToolName('web_search')).toBe('联网搜索');
    expect(formatToolName('custom-tool name')).toBe('Custom Tool Name');
    expect(formatMaybeJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatMaybeJson('plain')).toBe('plain');
    expect(formatUnknownToolPayload({ ok: true })).toBe('{\n  "ok": true\n}');
  });
});
