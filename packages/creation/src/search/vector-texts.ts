import { createHash } from 'node:crypto';

import type { SearchPassage } from '../contracts/index.ts';

/** 一段要算向量的文字；hash 由文字算出，同样的文字只算一次，改动后的文字自然是新的一段。 */
export interface VectorText {
  hash: string;
  text: string;
}

/** 段落按整行切分，单独一行可以很长；超过这个长度时在句末切成几块，各算一个向量。 */
const blockSize = 1000;
const sentenceEnd = /[。！？!?；…”][^。！？!?；…”]*$/;

function hashed(text: string): VectorText {
  return { hash: createHash('sha256').update(text).digest('hex'), text };
}

function blocks(text: string): string[] {
  const result: string[] = [];
  let rest = text;
  while (rest.length > blockSize) {
    const end = rest.slice(0, blockSize).search(sentenceEnd);
    // 整块里没有句末标点时按长度切。
    const cut = end > 0 ? end + 1 : blockSize;
    result.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) result.push(rest);
  return result;
}

/** 条目里一个段落要算的向量：标题在前，让向量带上出处。命中任意一块都算命中这个段落。 */
export function passageVectorTexts(title: string, passage: SearchPassage): VectorText[] {
  return blocks(passage.text).map(block => hashed(`${title}\n${block}`));
}

/** 事件或关系要算的向量：涉及的资料名在前。 */
export function noteVectorText(names: readonly string[], text: string): VectorText {
  return hashed(`${names.join('、')}\n${text}`);
}
