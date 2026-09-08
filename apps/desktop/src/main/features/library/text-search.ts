import type { WorkspaceTextMatch } from '@chaptale/ipc-contract';

/** 偏移与 CodeMirror 一致，以归一化换行后的 UTF-16 计数；只接受字面文本。 */
export function findTextMatches(
  content: string,
  query: string,
  matchCase: boolean,
  limit: number
): Array<Omit<WorkspaceTextMatch, 'sourcePath' | 'title' | 'contentHash'>> {
  if (!query || limit <= 0) return [];
  const text = content.replace(/\r\n?/g, '\n');
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  const matches: ReturnType<typeof findTextMatches> = [];
  let line = 1;
  let lineOffset = 0;
  for (const match of text.matchAll(pattern)) {
    const from = match.index;
    for (let i = lineOffset; i < from; i++) if (text[i] === '\n') line++;
    lineOffset = from;
    const to = from + match[0].length;
    const start = Math.max(text.lastIndexOf('\n', from - 1) + 1, from - 55);
    const nextLine = text.indexOf('\n', to);
    const end = Math.min(nextLine < 0 ? text.length : nextLine, to + 90);
    matches.push({
      line,
      from,
      to,
      before: text.slice(start, from),
      text: match[0],
      after: text.slice(to, end)
    });
    if (matches.length >= limit) break;
  }
  return matches;
}
