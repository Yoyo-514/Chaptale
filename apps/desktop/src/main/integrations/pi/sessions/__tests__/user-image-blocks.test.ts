import { describe, expect, it } from 'vitest';

import { getPiUserImageBlocks } from '../user-image-blocks';

describe('getPiUserImageBlocks', () => {
  it('preserves native Pi content indexes for valid user image blocks', () => {
    expect(
      getPiUserImageBlocks({
        role: 'user',
        content: [
          { type: 'text', text: '图片' },
          { type: 'image', data: 'YWJj', mimeType: 'image/png' },
          { type: 'image', data: 'ZGVm', mimeType: 'image/webp' }
        ]
      })
    ).toEqual([
      { type: 'image', data: 'YWJj', mimeType: 'image/png', blockIndex: 1 },
      { type: 'image', data: 'ZGVm', mimeType: 'image/webp', blockIndex: 2 }
    ]);
  });

  it('ignores non-user messages and malformed image blocks', () => {
    expect(getPiUserImageBlocks({ role: 'assistant', content: [] })).toEqual([]);
    expect(
      getPiUserImageBlocks({
        role: 'user',
        content: [null, { type: 'image', data: 123, mimeType: 'image/png' }, { type: 'image', data: 'YWJj' }]
      })
    ).toEqual([]);
  });
});
