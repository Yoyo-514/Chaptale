import { describe, expect, it } from 'vitest';

import { IdentifyAssetValidator } from '../../templates';
import { FinalizeChapterValidator, RestoreVersionValidator } from '../../writing';
import { MemoryInspectPendingArgsValidator, MemoryResolvePendingArgsValidator } from '../memory';

describe('asset and version boundaries', () => {
  it('requires a safe target, template fingerprint and document baseline', () => {
    const request = {
      rootPath: 'E:/book',
      relativePath: '角色/甲.md',
      expectedHash: 'a'.repeat(64),
      templateId: 'character-main',
      templateHash: 'b'.repeat(64)
    };
    expect(IdentifyAssetValidator.Check([request])).toBe(true);
    expect(IdentifyAssetValidator.Check([{ ...request, relativePath: '../outside.md' }])).toBe(false);
    expect(IdentifyAssetValidator.Check([{ ...request, expectedHash: 'stale' }])).toBe(false);
    expect(IdentifyAssetValidator.Check([{ ...request, content: 'hidden replacement' }])).toBe(false);
  });
  it('restore accepts only the snapshot id and expected current hash, never arbitrary content', () => {
    const target = { rootPath: 'E:/book', targetPath: '正文/一.md', expectedHash: 'a'.repeat(64) };
    expect(FinalizeChapterValidator.Check([target])).toBe(true);
    expect(RestoreVersionValidator.Check([{ ...target, snapshotId: 'saved-version' }])).toBe(true);
    expect(RestoreVersionValidator.Check([{ ...target, snapshotId: '../../other' }])).toBe(false);
    expect(RestoreVersionValidator.Check([{ ...target, snapshotId: 'saved-version', content: 'replace' }])).toBe(false);
  });
  it('pending inspection and confirmation bind to a valid proposal fingerprint', () => {
    expect(MemoryInspectPendingArgsValidator.Check([{ id: 'p-1', rootPath: 'E:/book' }])).toBe(true);
    expect(MemoryInspectPendingArgsValidator.Check([{ id: '../p-1' }])).toBe(false);
    expect(
      MemoryResolvePendingArgsValidator.Check([
        { id: 'p-1', action: 'accept', expectedProposalHash: `sha1:${'a'.repeat(40)}` }
      ])
    ).toBe(true);
    expect(MemoryResolvePendingArgsValidator.Check([{ id: 'p-1', action: 'accept', expectedProposalHash: '' }])).toBe(
      false
    );
  });
});
