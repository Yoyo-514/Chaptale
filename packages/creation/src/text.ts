/** 汉字逐字计数，其他字母数字连续段计一个词；插图行不计，标题与资料属性由调用方分开。 */
export function countDocumentWords(content: string): number {
  return (
    content.replace(illustrationLine, '').match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu)?.length ?? 0
  );
}

/** 插图独占一行：`![说明](entry:<图片文件条目ID>)`，只在 Markdown 文稿中生效；行尾的 \r 留在原文中。 */
const illustrationLine = /^!\[([^\]\n]*)\]\(entry:([\w-]+)\)(?=\r?$)/gmu;
/** Agent 看到的插图占位：`[插图：说明 entry:<ID>]`。 */
const placeholderLine = /^\[插图：([^\]\n]*?) entry:([\w-]+)\](?=\r?$)/gmu;

export interface Illustration {
  caption: string;
  entryId: string;
}

export function parseIllustration(line: string): Illustration | null {
  const match = new RegExp(illustrationLine.source, 'u').exec(line);
  return match ? { caption: match[1]!, entryId: match[2]! } : null;
}

export function formatIllustration({ caption, entryId }: Illustration): string {
  return `![${caption}](entry:${entryId})`;
}

export function illustrationIds(content: string): Set<string> {
  return new Set([...content.matchAll(illustrationLine)].map(match => match[2]!));
}

export function toIllustrationPlaceholders(content: string): string {
  return content.replace(illustrationLine, (_line, caption: string, id: string) => `[插图：${caption} entry:${id}]`);
}

export function fromIllustrationPlaceholders(text: string): string {
  return text.replace(placeholderLine, (_line, caption: string, id: string) =>
    formatIllustration({ caption, entryId: id })
  );
}
