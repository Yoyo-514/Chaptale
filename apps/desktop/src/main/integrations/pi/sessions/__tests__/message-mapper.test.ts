import { describe, expect, it } from 'vitest';

import { fromPiMessage } from '../message-mapper';

describe('Pi session message mapper', () => {
  it('maps persisted assistant usage into the chat message', () => {
    const message = fromPiMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '回答' }],
      stopReason: 'stop',
      usage: {
        input: 900,
        output: 300,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1200,
        cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 }
      },
      timestamp: 789
    });

    expect(message).toMatchObject({
      role: 'assistant',
      usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200, cost: 0.003 }
    });

    const withoutUsage = fromPiMessage({ role: 'assistant', content: [{ type: 'text', text: '回答' }] });
    expect(withoutUsage).toMatchObject({ role: 'assistant' });
    expect((withoutUsage as { usage?: unknown }).usage).toBeUndefined();
  });

  it('restores user context files and hides the persisted prompt envelope', () => {
    const prompt = `<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">正文</file>\n</attached_context_files>\n\n检查附件`;

    expect(fromPiMessage({ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: 123 })).toEqual({
      role: 'user',
      content: '检查附件',
      contextFiles: [
        {
          path: 'C:/novel/outline.md',
          name: 'outline.md',
          size: 2048,
          kind: 'text',
          mimeType: undefined,
          skippedReason: undefined
        }
      ],
      timestamp: 123
    });
  });

  it('restores compact skill invocation metadata without exposing persisted instructions', () => {
    const prompt = `<skill name="review" location="C:/skills/review/SKILL.md">\nReferences are relative to C:/skills/review.\n\n完整技能说明\n</skill>\n\n<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">正文</file>\n</attached_context_files>\n\n检查第一章`;

    expect(fromPiMessage({ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: 321 })).toEqual({
      role: 'user',
      content: '检查第一章',
      contextFiles: [
        {
          path: 'C:/novel/outline.md',
          name: 'outline.md',
          size: 2048,
          kind: 'text',
          mimeType: undefined,
          skippedReason: undefined
        }
      ],
      skillInvocation: {
        name: 'review',
        arguments: '检查第一章'
      },
      timestamp: 321
    });
  });

  it('preserves native pi image blocks on user messages', () => {
    expect(
      fromPiMessage(
        {
          role: 'user',
          content: [
            { type: 'text', text: '这个图片呢？' },
            { type: 'image', data: 'YWJj', mimeType: 'image/webp' }
          ],
          timestamp: 456
        },
        {
          presentUserImages: images => ({
            attachments: images.map(image => ({
              type: 'imageAttachment',
              id: `image-${image.blockIndex}`,
              mimeType: image.mimeType,
              originalBytes: 3,
              width: 100,
              height: 80,
              thumbnailDataUrl: 'data:image/png;base64,dGh1bWI='
            }))
          })
        }
      )
    ).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '这个图片呢？' },
        {
          type: 'imageAttachment',
          id: 'image-1',
          mimeType: 'image/webp',
          originalBytes: 3,
          width: 100,
          height: 80,
          thumbnailDataUrl: 'data:image/png;base64,dGh1bWI='
        }
      ],
      timestamp: 456
    });
  });

  it('drops unsafe image blocks from untrusted session history', () => {
    expect(
      fromPiMessage({
        role: 'user',
        content: [
          { type: 'text', text: '图片' },
          { type: 'image', data: 'PHN2Zz4=', mimeType: 'image/svg+xml' },
          { type: 'image', data: '', mimeType: 'image/png' }
        ]
      })
    ).toEqual({
      role: 'user',
      content: '图片',
      timestamp: undefined
    });
  });

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
