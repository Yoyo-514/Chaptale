import { describe, expect, it } from 'vitest';

import {
  blankToUndefined,
  cleanUrlToken,
  collapseWhitespace,
  getHostname,
  isRecord,
  readFiniteNumber,
  readString,
  stripTrailingSlashes,
  stripUndefined
} from '..';

describe('shared utils', () => {
  it('narrows plain records without accepting arrays or null', () => {
    expect(isRecord({ enabled: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it('reads primitive values only when their type is valid', () => {
    expect(readString('value')).toBe('value');
    expect(readString(1)).toBeUndefined();
    expect(readFiniteNumber(42)).toBe(42);
    expect(readFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(readFiniteNumber('42')).toBeUndefined();
  });

  it('normalizes optional strings for config serialization', () => {
    expect(blankToUndefined('  token  ')).toBe('token');
    expect(blankToUndefined('   ')).toBeUndefined();
    expect(stripTrailingSlashes('https://api.example.com///')).toBe('https://api.example.com');
    expect(collapseWhitespace('  a\n\t b   c  ')).toBe('a b c');
  });

  it('strips undefined recursively while preserving falsey configured values', () => {
    expect(
      stripUndefined({
        enabled: false,
        count: 0,
        token: undefined,
        nested: { value: 'x', missing: undefined },
        items: [{ id: 1, skipped: undefined }]
      })
    ).toEqual({ enabled: false, count: 0, nested: { value: 'x' }, items: [{ id: 1 }] });
  });

  it('extracts display hostnames and cleans markdown URL tokens', () => {
    expect(getHostname('https://www.example.com/path')).toBe('example.com');
    expect(getHostname('not a url')).toBe('not a url');
    expect(cleanUrlToken('https://example.com/path),')).toBe('https://example.com/path');
  });
});
