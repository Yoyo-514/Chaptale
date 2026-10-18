import { describe, expect, it } from 'vitest';

import {
  UpdateChaptaleSettingsArgsValidator,
  ListDirectoryArgsValidator,
  CreateEntryArgsValidator,
  ReadDocumentArgsValidator,
  MAX_DOCUMENT_BYTES
} from '../../index';

function expectStrictObject(
  validator: { Check(value: unknown): boolean },
  validPayload: Record<string, unknown>
): void {
  expect(validator.Check([validPayload])).toBe(true);
  expect(validator.Check([{ ...validPayload, extra: true }])).toBe(false);
}

describe('IPC 参数 Schema', () => {
  it('校验应用设置更新参数', () => {
    expectStrictObject(UpdateChaptaleSettingsArgsValidator, {});
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ workspace: { path: '' } }])).toBe(true);
    // null 是「关闭当前作品」的显式信号，不是省略字段。
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ workspace: { path: null } }])).toBe(true);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ workspace: { path: 123 } }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ workspace: { workspacePath: '/tmp' } }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ storage: { mode: 'global' } }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ lastSessionId: null }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ explorer: { showInternalFiles: true } }])).toBe(true);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ explorer: { showInternalFiles: 'yes' } }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ explorer: { unknown: true } }])).toBe(false);
  });

  it('作品目录与新建参数只接无穿越的正斜杠相对路径', () => {
    // 空串是根目录，listDirectory 必须接受。
    expect(ListDirectoryArgsValidator.Check([{ relativePath: '' }])).toBe(true);
    expect(ListDirectoryArgsValidator.Check([{ relativePath: '正文/第一卷', includeInternal: true }])).toBe(true);
    expect(ListDirectoryArgsValidator.Check([{ relativePath: '../outside' }])).toBe(false);
    expect(ListDirectoryArgsValidator.Check([{ relativePath: '正文/../../etc' }])).toBe(false);
    expect(ListDirectoryArgsValidator.Check([{ relativePath: '/abs' }])).toBe(false);
    expect(ListDirectoryArgsValidator.Check([{ relativePath: 'E:\\novel' }])).toBe(false);
    expect(ListDirectoryArgsValidator.Check([{ relativePath: '正文//空段' }])).toBe(false);
    expect(ListDirectoryArgsValidator.Check([{ relativePath: '', extra: true }])).toBe(false);

    // 根目录已经存在，新建不接空串。
    expect(CreateEntryArgsValidator.Check([{ relativePath: '', kind: 'file' }])).toBe(false);
    expect(CreateEntryArgsValidator.Check([{ relativePath: '正文/第一章.md', kind: 'file' }])).toBe(true);
    expect(CreateEntryArgsValidator.Check([{ relativePath: '设定', kind: 'directory' }])).toBe(true);
    expect(CreateEntryArgsValidator.Check([{ relativePath: '../outside.md', kind: 'file' }])).toBe(false);
    expect(CreateEntryArgsValidator.Check([{ relativePath: 'a.md', kind: 'symlink' }])).toBe(false);
    expect(CreateEntryArgsValidator.Check([{ relativePath: 'a.md' }])).toBe(false);
  });

  it('正文读取绑定作品身份，只允许具体相对路径与有限字节预算', () => {
    const args = { rootPath: 'E:/novel', relativePath: '正文/第一章.md' };
    expectStrictObject(ReadDocumentArgsValidator, args);
    expect(ReadDocumentArgsValidator.Check([{ ...args, maxBytes: 0 }])).toBe(true);
    expect(ReadDocumentArgsValidator.Check([{ ...args, maxBytes: MAX_DOCUMENT_BYTES }])).toBe(true);
    expect(ReadDocumentArgsValidator.Check([{ ...args, maxBytes: MAX_DOCUMENT_BYTES + 1 }])).toBe(false);
    expect(ReadDocumentArgsValidator.Check([{ ...args, maxBytes: -1 }])).toBe(false);
    expect(ReadDocumentArgsValidator.Check([{ ...args, maxBytes: 1.5 }])).toBe(false);
    expect(ReadDocumentArgsValidator.Check([{ relativePath: 'chapter.md' }])).toBe(false);
    expect(ReadDocumentArgsValidator.Check([{ ...args, rootPath: '' }])).toBe(false);
    for (const relativePath of ['', '.', './a', '..', 'a/../b', '/a', 'a//b', 'a/', 'E:/a', 'a\\b', 'a\0b']) {
      expect(ReadDocumentArgsValidator.Check([{ ...args, relativePath }]), relativePath).toBe(false);
    }
  });
});
