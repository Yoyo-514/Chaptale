import { describe, expect, it } from 'vitest';

import { SettlementValidators } from '../../settlement';

describe('结算 IPC 边界', () => {
  it('接受完整请求，拒绝越界路径与多余能力', () => {
    const valid = {
      rootPath: 'E:/book',
      chapterPath: '正文/一.md',
      packId: 'pack-one',
      batchId: 'batch-one',
      expectedHash: 'a'.repeat(64),
      model: { provider: 'fixture', modelId: 'saved-output' },
      autoAcceptSummary: false
    };
    expect(SettlementValidators.start.Check([valid])).toBe(true);
    expect(SettlementValidators.start.Check([{ ...valid, chapterPath: '../secret.md' }])).toBe(false);
    expect(SettlementValidators.start.Check([{ ...valid, autoAcceptCanon: true }])).toBe(false);
    expect(
      SettlementValidators.resolve.Check([
        { rootPath: valid.rootPath, batchId: 'batch-one', revision: 0, itemId: 'summary', action: 'accept' }
      ])
    ).toBe(false);
  });
});
