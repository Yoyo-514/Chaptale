/** 汉字逐字计数，其他字母数字连续段计一个词；标题与资料属性由调用方分开。 */
export function countDocumentWords(content: string): number {
  let count = 0;
  for (const _match of content.matchAll(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu)) count += 1;
  return count;
}
