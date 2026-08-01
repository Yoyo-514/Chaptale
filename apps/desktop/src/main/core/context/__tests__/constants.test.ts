import { describe, expect, it } from 'vitest';

import {
  MAX_CONTEXT_FILE_BYTES,
  MAX_DIRECT_BYTES,
  MAX_DIRECT_TOKENS,
  MAX_DIRECT_TOTAL_BYTES,
  MAX_PROMPT_IMAGE_BYTES
} from '../constants';

describe('context file limits', () => {
  it('keeps the documented production boundaries', () => {
    expect(MAX_CONTEXT_FILE_BYTES).toBe(512 * 1024 * 1024);
    expect(MAX_DIRECT_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_DIRECT_TOTAL_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_PROMPT_IMAGE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_DIRECT_TOKENS).toBe(2_000_000);
  });
});
