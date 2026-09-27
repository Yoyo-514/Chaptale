import { describe, expect, it } from 'vitest';

import { isExternalAccessCapability, parseExternalDirectoryRule } from '../permissions';

describe('作品外访问能力', () => {
  it('只有 external_read / external_write 算作品外能力', () => {
    expect(isExternalAccessCapability('external_read')).toBe(true);
    expect(isExternalAccessCapability('external_write')).toBe(true);
    expect(isExternalAccessCapability('read')).toBe(false);
  });

  it('解析目录前缀规则；裸能力名、空前缀、精确路径与普通工具规则都不算目录授权', () => {
    expect(parseExternalDirectoryRule('external_read(E:/资料/*)')).toEqual({
      capability: 'external_read',
      directory: 'E:/资料/'
    });
    expect(parseExternalDirectoryRule('external_write(/home/me/导出/*)')).toEqual({
      capability: 'external_write',
      directory: '/home/me/导出/'
    });
    expect(parseExternalDirectoryRule('external_read')).toBeNull();
    expect(parseExternalDirectoryRule('external_read(*)')).toBeNull();
    expect(parseExternalDirectoryRule('external_read(E:/资料/a.md)')).toBeNull();
    expect(parseExternalDirectoryRule('write(草稿/*)')).toBeNull();
  });
});
