import { expect, it } from 'vitest';

import {
  countDocumentWords,
  formatIllustration,
  fromIllustrationPlaceholders,
  illustrationIds,
  parseIllustration,
  toIllustrationPlaceholders
} from '@chaptale/creation/text';

it('插图只认独占一行的 entry 引用，行尾 \\r 保留在原文中', () => {
  expect(parseIllustration('![城门](entry:img-1)')).toEqual({ caption: '城门', entryId: 'img-1' });
  expect(parseIllustration('看见 ![城门](entry:img-1)')).toBeNull();
  expect(parseIllustration('![城门](img.png)')).toBeNull();
  expect(formatIllustration({ caption: '', entryId: 'a' })).toBe('![](entry:a)');
  expect(countDocumentWords('雨停了。\n![城门 夜景](entry:a)')).toBe(3);
  const content = '![城门](entry:a)\r\n文字 ![x](entry:b)\n![雪](entry:c)';
  expect([...illustrationIds(content)]).toEqual(['a', 'c']);
  expect(toIllustrationPlaceholders(content)).toBe('[插图：城门 entry:a]\r\n文字 ![x](entry:b)\n[插图：雪 entry:c]');
});

it('Agent 占位与插图语法互相还原，正文中的普通方括号不受影响', () => {
  const content = '开头。\n![城门 夜景](entry:a)\n[插图：不是占位]\n结尾。';
  const placeholders = toIllustrationPlaceholders(content);
  expect(placeholders).toBe('开头。\n[插图：城门 夜景 entry:a]\n[插图：不是占位]\n结尾。');
  expect(fromIllustrationPlaceholders(placeholders)).toBe(content);
});
