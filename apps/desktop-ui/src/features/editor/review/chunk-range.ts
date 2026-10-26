import type { Chunk } from '@codemirror/merge';
import type { Text } from '@codemirror/state';

import type { ReviewRange } from '@chaptale/creation/contracts';

/** 原文各行起点；编辑器把 \r\n、\r 统一为一个换行，偏移需按行映射回原文。 */
function lineStarts(raw: string): number[] {
  const starts = [0];
  for (const match of raw.matchAll(/\r\n?|\n/g)) starts.push(match.index + match[0].length);
  return starts;
}

function toRaw(doc: Text, starts: number[], pos: number): number {
  const line = doc.lineAt(pos);
  return starts[line.number - 1] + pos - line.from;
}

/**
 * 合并块按整行划分，末行没有换行时块终点越过文末一位。
 * 只有一侧越过文末时，两侧都向前包含上一行的换行，使「接受/拒绝」与编辑器的结果一致；
 * 这种块从首行开始时无法用区间表达，返回 null 由调用方提示整篇处理。
 */
export function chunkRange(
  chunk: Pick<Chunk, 'fromA' | 'toA' | 'fromB' | 'toB'>,
  docA: Text,
  docB: Text,
  rawA: string,
  rawB: string
): ReviewRange | null {
  const pastA = chunk.toA > docA.length;
  const pastB = chunk.toB > docB.length;
  let { fromA, toA, fromB, toB } = chunk;
  if (pastA !== pastB) {
    if (fromA === 0 || fromB === 0) return null;
    fromA -= 1;
    fromB -= 1;
    toA = pastA ? docA.length : toA - 1;
    toB = pastB ? docB.length : toB - 1;
  } else if (pastA) {
    toA = docA.length;
    toB = docB.length;
  }
  const startsA = lineStarts(rawA);
  const startsB = lineStarts(rawB);
  return {
    fromA: toRaw(docA, startsA, fromA),
    toA: toRaw(docA, startsA, toA),
    fromB: toRaw(docB, startsB, fromB),
    toB: toRaw(docB, startsB, toB)
  };
}

/** 作者手改按候选原有的主要换行写回。 */
export function serializeLike(doc: Text, raw: string): string {
  const separator = /\r\n?|\n/.exec(raw)?.[0] ?? '\n';
  return doc.toJSON().join(separator);
}
