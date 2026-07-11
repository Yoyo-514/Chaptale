import { describe, expect, it } from 'vitest';

import { decodeContextMessage } from '../context-files/context-message-codec';

describe('context message codec', () => {
  it('extracts text and document metadata from the Chaptale prompt envelope', () => {
    const prompt = `<attached_context_files>\n<file path="C:/小说/&quot;draft&quot;&amp;outline.md" handling="file-input-text" size="2 KB">正文</file>\n<file path="C:/小说/reference.pdf" handling="document-file-input" kind="document" mimeType="application/pdf" size="4 KB">文档</file>\n</attached_context_files>\n\n请分析 <xml> 内容`;

    const result = decodeContextMessage(prompt);

    expect(result.text).toBe('请分析 <xml> 内容');
    expect(result.contextFiles).toEqual([
      {
        path: 'C:/小说/"draft"&outline.md',
        name: '"draft"&outline.md',
        size: 2048,
        kind: 'text',
        mimeType: undefined,
        skippedReason: undefined
      },
      {
        path: 'C:/小说/reference.pdf',
        name: 'reference.pdf',
        size: 4096,
        kind: 'document',
        mimeType: 'application/pdf',
        skippedReason: undefined
      }
    ]);
  });

  it('decodes legacy file envelopes without exposing embedded file content as user text', () => {
    const prompt = `<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">\n<content>正文</content>\n</file>\n</attached_context_files>\n\n检查大纲`;

    expect(decodeContextMessage(prompt)).toEqual({
      text: '检查大纲',
      promptPrefix:
        '<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">\n<content>正文</content>\n</file>\n</attached_context_files>\n\n',
      contextFiles: [
        {
          path: 'C:/novel/outline.md',
          name: 'outline.md',
          size: 2048,
          kind: 'text',
          mimeType: undefined,
          skippedReason: undefined
        }
      ]
    });
  });

  it('preserves unavailable attachment metadata for message rendering', () => {
    const prompt = `<attached_context_files>\n<file path="C:/novel/missing.txt" kind="text" skipped="true" reason="file-unavailable">无法读取</file>\n</attached_context_files>\n\n继续处理`;

    expect(decodeContextMessage(prompt).contextFiles).toEqual([
      {
        path: 'C:/novel/missing.txt',
        name: 'missing.txt',
        size: 0,
        kind: 'text',
        mimeType: undefined,
        skippedReason: 'file-unavailable'
      }
    ]);
  });

  it('leaves ordinary and malformed messages untouched', () => {
    expect(decodeContextMessage('普通消息')).toEqual({ text: '普通消息', promptPrefix: '', contextFiles: [] });
    expect(decodeContextMessage('<attached_context_files>未闭合')).toEqual({
      text: '<attached_context_files>未闭合',
      promptPrefix: '',
      contextFiles: []
    });
  });
});
