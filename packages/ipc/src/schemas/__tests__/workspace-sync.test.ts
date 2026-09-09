import { describe, expect, it } from 'vitest';

import { SelectDirectoryArgsValidator, WorkspaceGetStateArgsValidator, WorkspaceRootArgsValidator } from '../workspace';

describe('文件与同步契约', () => {
  it('支持旧目录选择与带初始位置的选择，不接收未知指令', () => {
    for (const args of [[], [{}], [{ defaultPath: 'C:/OneDrive', purpose: 'open' }], [{ purpose: 'create' }]]) {
      expect(SelectDirectoryArgsValidator.Check(args)).toBe(true);
    }
    for (const args of [
      [{ defaultPath: '' }],
      [{ purpose: 'delete' }],
      [{ defaultPath: 'x'.repeat(4097) }],
      [{ extra: true }]
    ]) {
      expect(SelectDirectoryArgsValidator.Check(args)).toBe(false);
    }
  });
  it('检测不允许任意参数，打开目录要求明确根路径', () => {
    expect(WorkspaceGetStateArgsValidator.Check([])).toBe(true);
    expect(WorkspaceGetStateArgsValidator.Check([{ path: 'C:/' }])).toBe(false);
    expect(WorkspaceRootArgsValidator.Check([{ rootPath: 'C:/OneDrive' }])).toBe(true);
    expect(WorkspaceRootArgsValidator.Check([{ rootPath: '', command: 'open' }])).toBe(false);
  });
});
