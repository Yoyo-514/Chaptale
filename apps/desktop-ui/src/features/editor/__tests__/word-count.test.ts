import { describe, expect, it } from 'vitest';

import { countDocumentWords } from '../word-count';

describe('正文计数', () => {
  it.each([
    ['', 0],
    ['  \n，。!?', 0],
    ['Alice望向Bob的3D模型。', 8],
    ['---\ntitle: 不计入正文\n---\n甲乙 hello world', 4],
    ['\uFEFF---\r\ntitle: 不计入正文\r\n---\r\n甲乙', 2],
    ['---\ntitle: 未闭合\n甲乙', 6]
  ])('%j 计为 %i', (content, expected) => {
    expect(countDocumentWords(content)).toBe(expected);
  });
});
