import { describe, expect, it } from 'vitest';

import type { Entry } from '@chaptale/creation/contracts';

import { chapterOrder, readingBlocks } from '../reading/blocks';

function entry(fields: Partial<Entry> & Pick<Entry, 'id' | 'position'>): Entry {
  return {
    parentId: null,
    section: 'manuscript',
    kind: 'document',
    title: fields.id,
    format: 'txt',
    fileName: null,
    wordCount: 0,
    revisionId: 'r',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...fields
  };
}

describe('分页阅读', () => {
  it('跨章顺序按正文目录深度优先，跳过目录与资料', () => {
    const entries = [
      entry({ id: '第三章', position: 2 }),
      entry({ id: '第一卷', position: 0, kind: 'directory', format: null }),
      entry({ id: '第二章', parentId: '第一卷', position: 1 }),
      entry({ id: '第一章', parentId: '第一卷', position: 0 }),
      entry({ id: '人物', position: 1, section: 'resource' }),
      entry({ id: '序章', position: 1 })
    ];
    expect(chapterOrder(entries).map(item => item.id)).toEqual(['第一章', '第二章', '序章', '第三章']);
  });

  it('TXT 每行一块，起点对应原文字符位置并转义', () => {
    const content = '雨停了。\n\n<b>街道</b>';
    const blocks = readingBlocks(content, 'txt');
    expect(blocks.map(block => block.offset)).toEqual([0, 5, 6]);
    expect(content.slice(blocks[2]!.offset)).toBe('<b>街道</b>');
    expect(blocks[2]!.html).toBe('&lt;b&gt;街道&lt;/b&gt;');
  });

  it('Markdown 按顶层块渲染，块起点对应原文位置', () => {
    const content = '# 第一章\n\n雨停了。\n\n- 街道\n- 灯火\n';
    const blocks = readingBlocks(content, 'markdown');
    expect(blocks.map(block => content.slice(block.offset, block.offset + 2))).toEqual(['# ', '雨停', '- ']);
    expect(blocks[0]!.html).toContain('<h1');
    expect(blocks[2]!.html).toContain('<li>灯火</li>');
  });
});
