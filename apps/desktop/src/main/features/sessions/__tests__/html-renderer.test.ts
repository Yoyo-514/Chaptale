import { describe, expect, it } from 'vitest';

import type { ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';

import { buildSessionHtml, toSafeFileName } from '../html-renderer';

function messageEntry(id: string, message: any): ChaptaleSessionTreeEntry {
  return { type: 'message', id, parentId: null, timestamp: '2026-07-11T00:00:00.000Z', message };
}

describe('buildSessionHtml', () => {
  it('renders user, assistant, tool, image, and compaction entries as standalone html', () => {
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
        content: '结构上有三个问题。',
        toolCalls: [{ id: 't1', name: 'web_search', arguments: { query: '三幕结构' } }],
        stopReason: 'length'
      }),
      messageEntry('r1', {
        role: 'tool',
        toolCallId: 't1',
        toolName: 'web_search',
        output: '搜索结果内容'
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

    const html = buildSessionHtml({ name: '大纲讨论', entries });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>大纲讨论</title>');
    expect(html).toContain('<style>');
    expect(html).toContain('marked');
    expect(html).toContain('purify');
    expect(html).toContain('data-markdown');
    expect(html).toContain('<span class="role">用户</span>');
    expect(html).toContain('帮我分析这份大纲');
    expect(html).toContain('data:image/png;base64,YWJj');
    expect(html).toContain('附件：C:/novel/outline.md');
    expect(html).toContain('<span class="role">助手</span>');
    expect(html).toContain('调用工具 <code>web_search</code>');
    expect(html).toContain('&quot;query&quot;: &quot;三幕结构&quot;');
    expect(html).toContain('达到输出长度上限，回复被截断');
    expect(html).toContain('工具 <code>web_search</code> 结果');
    expect(html).toContain('搜索结果内容');
    expect(html).toContain('历史摘要（压缩前 9000 tokens）');
    expect(html).toContain('前文摘要\n第二行');
  });

  it('skips entries without renderable content', () => {
    const entries: ChaptaleSessionTreeEntry[] = [
      { type: 'session_info', id: 'root', parentId: null, timestamp: '2026-07-11T00:00:00.000Z', name: '会话' },
      messageEntry('empty', { role: 'assistant', content: [] }),
      messageEntry('u1', { role: 'user', content: '正文' })
    ];

    const html = buildSessionHtml({ name: '会话', entries });

    expect(html).toContain('正文');
    expect(html).not.toContain('<span class="role">助手</span>');
  });

  /** 导出件是静态存档：正文断在半截时，读者手边没有会话可查，说明必须随文走。 */
  it('renders a guardrail stop alongside the message it interrupted', () => {
    const entries: ChaptaleSessionTreeEntry[] = [
      messageEntry('a1', { role: 'assistant', content: '写到一半' }),
      {
        type: 'run_stop',
        id: 's1',
        parentId: 'a1',
        timestamp: '2026-07-11T00:02:00.000Z',
        reason: 'token-budget'
      }
    ];

    const html = buildSessionHtml({ name: '会话', entries });

    expect(html).toContain('写到一半');
    expect(html).toContain('本轮触到 token 预算上限后停止');
  });
});

describe('toSafeFileName', () => {
  it('replaces characters that are invalid on Windows and truncates long names', () => {
    expect(toSafeFileName('第1章: "初雪" <修订版>?')).toBe('第1章- -初雪- -修订版-');
    expect(toSafeFileName('   ')).toBe('未命名会话');
    expect(toSafeFileName('长'.repeat(80))).toHaveLength(50);
  });
});
