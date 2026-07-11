import { describe, expect, it, vi } from 'vitest';

import { getPiUserEntrySnapshot } from '../pi-user-entry-snapshot';

function createManager(entry: unknown) {
  return { getEntry: vi.fn(() => entry) } as any;
}

describe('getPiUserEntrySnapshot', () => {
  it('preserves the Chaptale file envelope and every native Pi image', () => {
    const promptPrefix =
      '<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">正文</file>\n</attached_context_files>\n\n';
    const manager = createManager({
      type: 'message',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: `${promptPrefix}旧问题` },
          ...Array.from({ length: 12 }, (_, index) => ({
            type: 'image',
            data: Buffer.from(`image-${index}`).toString('base64'),
            mimeType: 'image/png'
          }))
        ]
      }
    });

    const snapshot = getPiUserEntrySnapshot(manager, 'entry-user');

    expect(manager.getEntry).toHaveBeenCalledWith('entry-user');
    expect(snapshot.promptPrefix).toBe(promptPrefix);
    expect(snapshot.imageBlocks).toHaveLength(12);
    expect(snapshot.imageBlocks[11]).toEqual({
      type: 'image',
      data: Buffer.from('image-11').toString('base64'),
      mimeType: 'image/png',
      blockIndex: 12
    });
  });

  it('recovers the attachment envelope from a native pi-expanded skill message', () => {
    const promptPrefix =
      '<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">正文</file>\n</attached_context_files>\n\n';
    const manager = createManager({
      type: 'message',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `<skill name="review" location="C:/skills/review/SKILL.md">\nReferences are relative to C:/skills/review.\n\n技能正文\n</skill>\n\n${promptPrefix}检查第一章`
          }
        ]
      }
    });

    expect(getPiUserEntrySnapshot(manager, 'entry-user').promptPrefix).toBe(promptPrefix);
  });

  it('rejects missing, non-user, and malformed Pi entries', () => {
    expect(() => getPiUserEntrySnapshot(createManager(undefined), 'missing')).toThrow('找不到');
    expect(() =>
      getPiUserEntrySnapshot(
        createManager({ type: 'message', message: { role: 'assistant', content: [] } }),
        'assistant'
      )
    ).toThrow('不是用户消息');
    expect(() =>
      getPiUserEntrySnapshot(
        createManager({
          type: 'message',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' }
            ]
          }
        }),
        'multi-text'
      )
    ).toThrow('仅包含一个');
  });
});
