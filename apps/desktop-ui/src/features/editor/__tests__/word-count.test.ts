import { describe, expect, it } from 'vitest';

import { countDocumentWords } from '@chaptale/creation/text';

describe('正文计数', () => {
  it.each([
    ['', 0],
    ['  \n，。!?', 0],
    ['Alice望向Bob的3D模型。', 8]
  ])('%j 计为 %i', (content, expected) => {
    expect(countDocumentWords(content)).toBe(expected);
  });
});
