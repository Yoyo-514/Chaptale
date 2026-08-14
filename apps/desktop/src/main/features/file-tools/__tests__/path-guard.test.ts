import { describe, expect, it } from 'vitest';

import { globToRegExp, isBinaryContent } from '../path-guard';

describe('globToRegExp', () => {
  it('* 单段匹配（不跨 /）；? 单字符；字面量转义', () => {
    const md = globToRegExp('*.md');

    expect(md.test('a.md')).toBe(true);
    expect(md.test('a/b.md')).toBe(false);
    expect(md.test('amd')).toBe(false);

    expect(globToRegExp('file?.txt').test('file1.txt')).toBe(true);
    expect(globToRegExp('file?.txt').test('file12.txt')).toBe(false);

    expect(globToRegExp('a+b.txt').test('a+b.txt')).toBe(true);
    expect(globToRegExp('a+b.txt').test('aab.txt')).toBe(false);
  });

  it('** 跨目录；a/**/b 同时命中 a/b', () => {
    const deep = globToRegExp('**/*.json');

    expect(deep.test('a.json')).toBe(true);
    expect(deep.test('x/y/z/a.json')).toBe(true);

    const mid = globToRegExp('a/**/b.md');

    expect(mid.test('a/b.md')).toBe(true);
    expect(mid.test('a/x/y/b.md')).toBe(true);
    expect(mid.test('x/a/b.md')).toBe(false);
  });
});

describe('isBinaryContent', () => {
  it('NUL 字节判二进制；纯文本放行', () => {
    expect(isBinaryContent(Buffer.from([0x89, 0x50, 0x00, 0x0a]))).toBe(true);
    expect(isBinaryContent(Buffer.from('普通文本内容'))).toBe(false);
    // NUL 在 8KB 之后：探测窗口外放行（首块采样）。
    const late = Buffer.alloc(9000, 0x61);
    late[8900] = 0;
    expect(isBinaryContent(late)).toBe(false);
  });
});
