import type { Entry } from '@chaptale/creation/contracts';
import { parseIllustration, type Illustration } from '@chaptale/creation/text';

import { escapeHtml, renderMarkdownBlocks } from '@/utils/markdown';

/** 阅读页里的一块正文及其在原文中的起点。 */
export interface ReadingBlock {
  offset: number;
  html: string;
  /** 插图独占一块，由阅读页按页宽显示图片。 */
  illustration?: Illustration;
}

/** Markdown 插图行单独成块，其余内容按顶层块渲染；插图行与相邻文字之间没有空行也会分开。 */
function markdownBlocks(content: string): ReadingBlock[] {
  const result: ReadingBlock[] = [];
  let segment = 0;
  let offset = 0;
  const flush = (end: number) => {
    if (end > segment)
      for (const block of renderMarkdownBlocks(content.slice(segment, end)))
        result.push({ offset: segment + block.offset, html: block.html });
  };
  for (const line of content.split('\n')) {
    const illustration = parseIllustration(line.replace(/\r$/, ''));
    if (illustration) {
      flush(offset);
      result.push({ offset, html: '', illustration });
      segment = offset + line.length + 1;
    }
    offset += line.length + 1;
  }
  flush(content.length);
  return result;
}

/** TXT 一行一块；Markdown 按顶层块渲染。 */
export function readingBlocks(content: string, format: Entry['format']): ReadingBlock[] {
  if (format === 'markdown') return markdownBlocks(content);
  let offset = 0;
  return content.split('\n').map(line => {
    const block = { offset, html: escapeHtml(line.replace(/\r$/, '')) };
    offset += line.length + 1;
    return block;
  });
}

/** 正文目录中的文稿，按目录顺序深度优先排列。 */
export function chapterOrder(entries: readonly Entry[]): Entry[] {
  const children = new Map<string | null, Entry[]>();
  for (const entry of entries) {
    if (entry.section !== 'manuscript') continue;
    children.set(entry.parentId, [...(children.get(entry.parentId) ?? []), entry]);
  }
  const ordered: Entry[] = [];
  const visit = (parentId: string | null) => {
    for (const entry of (children.get(parentId) ?? []).toSorted((a, b) => a.position - b.position)) {
      if (entry.kind === 'document') ordered.push(entry);
      else visit(entry.id);
    }
  };
  visit(null);
  return ordered;
}
