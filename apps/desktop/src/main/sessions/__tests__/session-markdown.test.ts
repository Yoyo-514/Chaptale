import { describe, expect, it } from 'vitest';

import type { ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';
import { buildSessionMarkdown, toSafeFileName } from '../session-markdown';

function messageEntry(id: string, message: any): ChaptaleSessionTreeEntry {
  return { type: 'message', id, parentId: null, timestamp: '2026-07-11T00:00:00.000Z', message };
}

describe('buildSessionMarkdown', () => {
  it('renders user, assistant, tool, and compaction entries as readable markdown', () => {
    const entries: ChaptaleSessionTreeEntry[] = [
      messageEntry('u1', {
        role: 'user',
        content: [
          { type: 'text', text: '帮我分析这份大纲' },
          {
            type: 'imageAttachment',
            id: 'img-1',
            mimeType: 'image/png',
            originalBytes: 3,
            width: 10,
            height: 10,
            thumbnailDataUrl: 'data:image/png;base64,YWJj'
          }
        ],
        contextFiles: [{ path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' }],
        timestamp: new Date('2026-07-11T08:30:00').getTime()
      }),
      messageEntry('a1', {
        role: 'assistant',
        content: [
          { type: 'text', text: '结构上有三个问题。' },
          { type: 'toolCall', id: 't1', name: 'web_search', arguments: { query: '三幕结构' } }
        ],
        stopReason: 'length'
      }),
      messageEntry('r1', {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'web_search',
        content: [{ type: 'text', text: '搜索结果内容' }]
      }),
      {
        type: 'compaction',
        id: 'c1',
        parentId: 'r1',
        timestamp: '2026-07-11T00:01:00.000Z',
        summary: '前文摘要\n第二行',
        firstKeptEntryId: 'r1',
        tokensBefore: 9000
      }
    ];

    const markdown = buildSessionMarkdown({ name: '大纲讨论', entries });

    expect(markdown).toContain('# 大纲讨论');
    expect(markdown).toContain('## 用户');
    expect(markdown).toContain('帮我分析这份大纲');
    expect(markdown).toContain('> 附带 1 张图片');
    expect(markdown).toContain('> 附件：outline.md');
    expect(markdown).toContain('## 助手');
    expect(markdown).toContain('> 调用工具 `web_search`');
    expect(markdown).toContain('> 达到输出长度上限，回复被截断');
    expect(markdown).toContain('**工具 web_search 结果**');
    expect(markdown).toContain('搜索结果内容');
    expect(markdown).toContain('> 此处之前的历史已压缩为摘要（原 9000 tokens）');
    expect(markdown).toContain('> 前文摘要\n> 第二行');
  });

  it('skips entries without renderable content', () => {
    const entries: ChaptaleSessionTreeEntry[] = [
      { type: 'session_info', id: 'root', parentId: null, timestamp: '2026-07-11T00:00:00.000Z', name: '会话' },
      messageEntry('empty', { role: 'assistant', content: [] }),
      messageEntry('u1', { role: 'user', content: '正文' })
    ];

    const markdown = buildSessionMarkdown({ name: '会话', entries });

    expect(markdown).toContain('正文');
    expect(markdown).not.toContain('## 助手');
  });
});

describe('toSafeFileName', () => {
  it('replaces characters that are invalid on Windows and truncates long names', () => {
    expect(toSafeFileName('第1章: "初雪" <修订版>?')).toBe('第1章- -初雪- -修订版-');
    expect(toSafeFileName('   ')).toBe('未命名会话');
    expect(toSafeFileName('长'.repeat(80))).toHaveLength(50);
  });
});
