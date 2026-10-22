import { describe, expect, it } from 'vitest';

import { CLOUD_PROVIDER_LABELS, CLOUD_PROVIDERS, isCloudProvider } from '../../cloud-sync';
import { CloudListFoldersArgsValidator, CloudNoArgsValidator, CloudProviderArgsValidator } from '../cloud-sync';

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
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'one drive', parentId: '' }])).toBe(false);
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'onedrive', parentId: 'x'.repeat(2049) }])).toBe(false);
    expect(CloudListFoldersArgsValidator.Check([{ provider: 'dropbox', root: true }])).toBe(false);
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
