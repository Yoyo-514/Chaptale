import { describe, expect, it } from 'vitest';

import { formatFileSize } from '../format';

describe('formatFileSize', () => {
  it('formats bytes, KB, and MB with stable precision', () => {
    expect(formatFileSize(12)).toBe('12 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('2 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1536 * 1024)).toBe('1.5 MB');
  });
});
