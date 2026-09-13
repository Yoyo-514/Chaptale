import { describe, expect, it } from 'vitest';

import { CLOUD_PROVIDER_LABELS, CLOUD_PROVIDERS, isCloudProvider } from '../../cloud-sync';
import {
  CloudListFoldersArgsValidator,
  CloudNoArgsValidator,
  CloudProviderArgsValidator,
  CloudRestoreArgsValidator,
  CloudRestoreDiffArgsValidator
} from '../cloud-sync';

describe('云同步契约', () => {
  it('状态检测不接受任何参数，避免渲染侧用参数试探主进程', () => {
    expect(CloudNoArgsValidator.Check([])).toBe(true);
    expect(CloudNoArgsValidator.Check([{ provider: 'dropbox' }])).toBe(false);
  });
  it('授权与登出只接受已知服务商，且不允许附加字段', () => {
    for (const provider of CLOUD_PROVIDERS) {
      expect(CloudProviderArgsValidator.Check([{ provider }])).toBe(true);
    }
    for (const args of [
      [],
      [{}],
      [{ provider: 'aliyun' }],
      [{ provider: 'Dropbox' }],
      [{ provider: 'dropbox', extra: true }]
    ]) {
      expect(CloudProviderArgsValidator.Check(args)).toBe(false);
    }
  });
  it('列目录允许省略或清空父目录，拒绝空串与超长标识', () => {
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'dropbox' }])).toBe(true);
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'dropbox', parentId: null }])).toBe(true);
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'onedrive', parentId: '/文稿' }])).toBe(true);
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'nutstore', parentId: '' }])).toBe(false);
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'nutstore', parentId: 'x'.repeat(2049) }])).toBe(false);
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'dropbox', root: true }])).toBe(false);
  });
  it('恢复参数只认三种模式与三种决议，额外的键一律挡掉', () => {
    expect(CloudRestoreArgsValidator.Check([{ archiveId: 'id:1', mode: 'new' }])).toBe(true);
    expect(CloudRestoreArgsValidator.Check([{ archiveId: 'id:1', mode: 'overwrite' }])).toBe(true);
    expect(
      CloudRestoreArgsValidator.Check([
        { archiveId: 'id:1', mode: 'merge', choices: { '草稿/01.md': 'archive', '正文.md': 'both' } }
      ])
    ).toBe(true);
    // 空决议表合法：作者可以先一项都不选。
    expect(CloudRestoreArgsValidator.Check([{ archiveId: 'id:1', mode: 'merge', choices: {} }])).toBe(true);

    for (const args of [
      [{ archiveId: 'id:1', mode: 'replace' }],
      [{ archiveId: 'id:1' }],
      [{ archiveId: '', mode: 'new' }],
      [{ archiveId: 'id:1', mode: 'merge', choices: { '正文.md': 'merge' } }],
      [{ archiveId: 'id:1', mode: 'new', overlap: true }]
    ]) {
      expect(CloudRestoreArgsValidator.Check(args)).toBe(false);
    }

    // 决议表的**键**不受 schema 约束（JSON Schema 的字符串长度管的是值不是键）。
    // 这里如实记下这个边界：执行侧只读匹配得上真实路径的键，其余一律忽略。
    expect(CloudRestoreArgsValidator.Check([{ archiveId: 'id:1', mode: 'merge', choices: { '': 'archive' } }])).toBe(
      true
    );
  });
  it('冲突项参数要同时有归档标识与归档内路径', () => {
    expect(CloudRestoreDiffArgsValidator.Check([{ archiveId: 'id:1', relativePath: '灵感/片段.md' }])).toBe(true);

    for (const args of [
      [{ archiveId: 'id:1' }],
      [{ relativePath: '正文.md' }],
      [{ archiveId: 'id:1', relativePath: '' }],
      [{ archiveId: 'id:1', relativePath: 'x'.repeat(1025) }],
      [{ archiveId: 'id:1', relativePath: '正文.md', mode: 'merge' }]
    ]) {
      expect(CloudRestoreDiffArgsValidator.Check(args)).toBe(false);
    }
  });
  it('服务商守卫挡掉落盘与手改配置里的未知取值', () => {
    expect(CLOUD_PROVIDERS).toEqual(['dropbox', 'onedrive', 'nutstore']);
    expect(Object.keys(CLOUD_PROVIDER_LABELS)).toEqual(CLOUD_PROVIDERS);
    for (const provider of CLOUD_PROVIDERS) {
      expect(isCloudProvider(provider)).toBe(true);
    }
    for (const value of ['', 'Dropbox', 'aliyun', undefined, null, 1, {}]) {
      expect(isCloudProvider(value)).toBe(false);
    }
  });
});
