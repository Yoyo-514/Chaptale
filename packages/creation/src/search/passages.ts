import type { SearchPassage } from '../contracts/index.ts';

/** 一段的目标长度；整行切分，单行超过时独立成段。 */
const passageSize = 400;
/** 每个条目最多返回的段落数。 */
const passagesPerEntry = 3;

/** 正文按行切成段落：相邻的行累积到目标长度为一段，首尾的空行不计入。 */
function splitPassages(content: string): SearchPassage[] {
  const passages: SearchPassage[] = [];
  const lines = content.split('\n');
  let start = -1;
  let end = -1;
  let size = 0;
  const flush = () => {
    if (start === -1) return;
    passages.push({ startLine: start + 1, endLine: end + 1, text: lines.slice(start, end + 1).join('\n') });
    start = -1;
    size = 0;
  };
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    if (size + line.length > passageSize) flush();
    if (start === -1) start = index;
    end = index;
    size += line.length;
  }
  flush();
  return passages;
}

/** 含查询词最多的几段，按原文顺序排列；没有任何一段含查询词时为空。 */
export function matchingPassages(content: string, terms: readonly string[]): SearchPassage[] {
  const words = terms.map(term => term.toLowerCase());
  return splitPassages(content)
    .map(passage => {
      const text = passage.text.toLowerCase();
      return { passage, score: words.filter(word => text.includes(word)).length };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.passage.startLine - b.passage.startLine)
    .slice(0, passagesPerEntry)
    .map(item => item.passage)
    .sort((a, b) => a.startLine - b.startLine);
}
