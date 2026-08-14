import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  ChatContextFile,
  ChatImageAttachment,
  ChatImageSource,
  ChatMessage,
  ChatMessageUsage,
  ChatRetryState,
  ChatSkillInvocation,
  ChatStopReason,
  ChatTextPart,
  ChatToolCall
} from '@chaptale/shared';

import {
  blankToUndefined,
  cleanUrlToken,
  collapseWhitespace,
  escapeXmlAttribute,
  escapeXmlText,
  formatFileSize,
  formatSkillInvocation,
  getHostname,
  isRecord,
  parseSkillInvocation,
  parseXmlAttributes,
  readBoolean,
  readFiniteNumber,
  readString,
  readStringArray,
  stripTrailingSlashes,
  stripUndefined,
  unescapeXmlAttribute
} from '..';

describe('shared public exports', () => {
  it('keeps chat domain types and constants available from the package root', () => {
    const text: ChatTextPart = { type: 'text', text: 'hello' };
    const imageSource: ChatImageSource = {
      type: 'session-entry',
      sessionId: 'session-id',
      entryId: 'entry-id',
      blockIndex: 0
    };
    const attachment: ChatImageAttachment = {
      type: 'imageAttachment',
      id: 'attachment-id',
      mimeType: 'image/png',
      originalBytes: 1024,
      width: 320,
      height: 180,
      thumbnailDataUrl: 'data:image/png;base64,base64',
      source: imageSource
    };
    const toolCall: ChatToolCall = {
      id: 'tool-call-id',
      name: 'read',
      arguments: { path: '/tmp/example.txt' }
    };
    const contextFile: ChatContextFile = {
      path: '/tmp/example.txt',
      name: 'example.txt',
      size: 128,
      kind: 'text'
    };
    const skillInvocation: ChatSkillInvocation = { name: 'review', arguments: 'chapter one' };
    const usage: ChatMessageUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30
    };
    const stopReason: ChatStopReason = 'toolUse';
    const retry: ChatRetryState = { status: 'retrying', attempt: 1, maxAttempts: 3 };
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [text, attachment],
        contextFiles: [contextFile],
        skillInvocation
      },
      { role: 'assistant', content: [text], toolCalls: [toolCall], stopReason, retry, usage },
      {
        role: 'tool',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: { ok: true },
        details: { ok: true }
      }
    ];

    expectTypeOf(messages).toMatchTypeOf<ChatMessage[]>();
    expectTypeOf(attachment).toMatchTypeOf<ChatImageAttachment>();
    expectTypeOf(contextFile).toMatchTypeOf<ChatContextFile>();
  });
});

describe('shared utils', () => {
  it('narrows plain records without accepting arrays or null', () => {
    expect(isRecord({ enabled: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it('reads primitive values only when their type is valid', () => {
    expect(readString('value')).toBe('value');
    expect(readString(1)).toBeUndefined();
    expect(readBoolean(false)).toBe(false);
    expect(readBoolean('false')).toBeUndefined();
    expect(readStringArray(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(readStringArray('a')).toBeUndefined();
    expect(readFiniteNumber(42)).toBe(42);
    expect(readFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(readFiniteNumber('42')).toBeUndefined();
  });

  it('normalizes optional strings for config serialization', () => {
    expect(blankToUndefined('  token  ')).toBe('token');
    expect(blankToUndefined('   ')).toBeUndefined();
    expect(stripTrailingSlashes('https://api.example.com///')).toBe('https://api.example.com');
    expect(collapseWhitespace('  a\n\t b   c  ')).toBe('a b c');
  });

  it('strips undefined recursively while preserving falsey configured values', () => {
    expect(
      stripUndefined({
        enabled: false,
        count: 0,
        token: undefined,
        nested: { value: 'x', missing: undefined },
        items: [{ id: 1, skipped: undefined }]
      })
    ).toEqual({ enabled: false, count: 0, nested: { value: 'x' }, items: [{ id: 1 }] });
  });

  it('extracts display hostnames and cleans markdown URL tokens', () => {
    expect(getHostname('https://www.example.com/path')).toBe('example.com');
    expect(getHostname('not a url')).toBe('not a url');
    expect(cleanUrlToken('https://example.com/path),')).toBe('https://example.com/path');
  });

  it('formats file sizes consistently across main and renderer code', () => {
    expect(formatFileSize(12)).toBe('12 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('2 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1536 * 1024)).toBe('1.5 MB');
  });

  it('parses and formats reusable skill invocations', () => {
    expect(parseSkillInvocation('/skill:review 检查第一章')).toEqual({
      name: 'review',
      arguments: '检查第一章'
    });
    expect(parseSkillInvocation('/SKILL:review')).toBeUndefined();
    expect(formatSkillInvocation({ name: 'review', arguments: '' })).toBe('/skill:review');
  });

  it('escapes XML text and attributes for prompt envelopes', () => {
    expect(escapeXmlText('<tag>&value')).toBe('&lt;tag&gt;&amp;value');
    expect(escapeXmlAttribute('"<tag>&value>')).toBe('&quot;&lt;tag&gt;&amp;value&gt;');
  });

  it('round-trips attribute values through escape and unescape', () => {
    const raw = `"<tag>&'value'`;
    expect(unescapeXmlAttribute(escapeXmlAttribute(raw))).toBe(raw);
  });

  it('parses XML attribute strings with unescaped values', () => {
    expect(parseXmlAttributes('path="a&amp;b.txt" data-kind="text" size="12 KB"')).toEqual({
      path: 'a&b.txt',
      'data-kind': 'text',
      size: '12 KB'
    });
    expect(parseXmlAttributes('')).toEqual({});
  });
});
