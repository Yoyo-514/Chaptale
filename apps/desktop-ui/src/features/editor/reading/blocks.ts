import type { Entry } from '@chaptale/creation/contracts';

import { escapeHtml, renderMarkdownBlocks } from '@/utils/markdown';

/** 阅读页里的一块正文及其在原文中的起点。 */
export interface ReadingBlock {
  offset: number;
  html: string;
}

/** TXT 一行一块；Markdown 按顶层块渲染。 */
export function readingBlocks(content: string, format: Entry['format']): ReadingBlock[] {
  if (format === 'markdown') return renderMarkdownBlocks(content);
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
