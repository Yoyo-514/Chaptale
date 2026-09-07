import { describe, expect, it } from 'vitest';

import { RewriteRequestValidator, RewriteSelectionValidator } from '../../writing';

const selection = { rootPath: 'E:/books/story', reviewId: 'review-1', issueIndexes: [0] };
const request = {
  ...selection,
  candidateId: 'candidate-1',
  expectedHash: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  outputHash: 'c'.repeat(64),
  packId: 'pack-1',
  allowStalePack: false,
  model: { provider: 'provider', modelId: 'model' }
};
describe('修订 IPC 契约', () => {
  it('确认与启动使用不同契约，启动必须绑定三份 hash 和实际模型', () => {
    expect(RewriteSelectionValidator.Check([selection])).toBe(true);
    expect(RewriteRequestValidator.Check([request])).toBe(true);
    expect(RewriteRequestValidator.Check([selection])).toBe(false);
    expect(RewriteRequestValidator.Check([{ ...request, sourceHash: 'old' }])).toBe(false);
  });
  it('空选择、越界索引、过量问题和非法记录 id 不通过', () => {
    for (const issueIndexes of [[], [-1], [0.5], Array.from({ length: 101 }, () => 0)])
      expect(RewriteSelectionValidator.Check([{ ...selection, issueIndexes }])).toBe(false);
    expect(RewriteRequestValidator.Check([{ ...request, reviewId: '../outside' }])).toBe(false);
  });
  it('Renderer 不能携带任意正文、替换或输出路径', () => {
    for (const key of ['content', 'replacement', 'outputRef'])
      expect(RewriteRequestValidator.Check([{ ...request, [key]: 'injected' }])).toBe(false);
  });
});
