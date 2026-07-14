import { describe, expect, it } from 'vitest';

import { getEnabledToolNames } from '../tool-whitelist';

describe('tool-whitelist', () => {
  it('enables pi file tools without enabling bash', () => {
    expect(getEnabledToolNames()).toEqual(
      expect.arrayContaining(['read', 'grep', 'find', 'ls', 'write', 'edit', 'web_search'])
    );
    expect(getEnabledToolNames()).not.toContain('bash');
  });
});
