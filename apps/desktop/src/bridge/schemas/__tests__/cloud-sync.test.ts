import { describe, expect, it } from 'vitest';

import { CLOUD_PROVIDER_LABELS, CLOUD_PROVIDERS, isCloudProvider } from '../../cloud-sync';
import {
  CloudBackupWorkArgsValidator,
  CloudBackupFileArgsValidator,
  CloudNoArgsValidator,
  CloudProviderArgsValidator
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
  it('备份要带作品与目标，下载要带云端文件标识', () => {
    expect(CloudBackupWorkArgsValidator.Check([{ workId: 'w1', target: 'all' }])).toBe(true);
    expect(CloudBackupWorkArgsValidator.Check([{ workId: 'w1', target: 'onedrive' }])).toBe(true);
    expect(CloudBackupWorkArgsValidator.Check([{ workId: '', target: 'all' }])).toBe(false);
    expect(CloudBackupWorkArgsValidator.Check([{ workId: 'w1' }])).toBe(false);
    expect(CloudBackupFileArgsValidator.Check([{ provider: 'onedrive', fileId: '/雨夜.chaptale' }])).toBe(true);
    expect(CloudBackupFileArgsValidator.Check([{ provider: 'onedrive', fileId: '' }])).toBe(false);
    expect(CloudBackupFileArgsValidator.Check([{ provider: 'onedrive', fileId: 'x'.repeat(2049) }])).toBe(false);
    expect(CloudBackupFileArgsValidator.Check([{ provider: 'dropbox', fileId: 'a', name: 'b' }])).toBe(false);
  });
  it('服务商守卫挡掉落盘与手改配置里的未知取值', () => {
    expect(CLOUD_PROVIDERS).toEqual(['dropbox', 'onedrive']);
    expect(Object.keys(CLOUD_PROVIDER_LABELS)).toEqual(CLOUD_PROVIDERS);
    for (const provider of CLOUD_PROVIDERS) {
      expect(isCloudProvider(provider)).toBe(true);
    }
    for (const value of ['', 'Dropbox', 'aliyun', undefined, null, 1, {}]) {
      expect(isCloudProvider(value)).toBe(false);
    }
  });
});
