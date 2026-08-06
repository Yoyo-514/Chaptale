import { describe, expect, it } from 'vitest';

import { MAX_CONTEXT_FILE_BYTES, MAX_DIRECT_BYTES, MAX_DIRECT_TOTAL_BYTES, MAX_PROMPT_IMAGE_BYTES } from '../constants';

describe('context file limits', () => {
  it('keeps direct-injection budgets below the single-file upload ceiling', () => {
    expect(MAX_DIRECT_BYTES).toBeLessThanOrEqual(MAX_CONTEXT_FILE_BYTES);
    expect(MAX_DIRECT_TOTAL_BYTES).toBeLessThanOrEqual(MAX_CONTEXT_FILE_BYTES);
    expect(MAX_PROMPT_IMAGE_BYTES).toBeLessThanOrEqual(MAX_CONTEXT_FILE_BYTES);
  });

  it('keeps per-file and per-request direct budgets consistent', () => {
    expect(MAX_DIRECT_TOTAL_BYTES).toBeGreaterThanOrEqual(MAX_DIRECT_BYTES);
  });
});
