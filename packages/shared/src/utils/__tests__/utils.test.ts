import { describe, expect, it } from 'vitest';

import {
  blankToUndefined,
  cleanUrlToken,
  collapseWhitespace,
  escapeXmlAttribute,
  escapeXmlText,
  formatFileSize,
  getHostname,
  isRecord,
  readBoolean,
  readFiniteNumber,
  readString,
  readStringArray,
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
    expect(readBoolean(false)).toBe(false);
    expect(readBoolean('false')).toBeUndefined();
    expect(readStringArray(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(readStringArray('a')).toBeUndefined();
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

  it('formats file sizes consistently across main and renderer code', () => {
    expect(formatFileSize(12)).toBe('12 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('2 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1536 * 1024)).toBe('1.5 MB');
  });

  it('escapes XML text and attributes for prompt envelopes', () => {
    expect(escapeXmlText('<tag>&value')).toBe('&lt;tag>&amp;value');
    expect(escapeXmlAttribute('"<tag>&value>')).toBe('&quot;&lt;tag>&amp;value&gt;');
  });
});
