/** 汉字逐字计数，其他字母数字连续段计一个词；有效文件头不计入正文。 */
export function countDocumentWords(content: string): number {
  const body = content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  return [...body.matchAll(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu)].length;
}
