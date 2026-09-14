import { createDropboxAdapter } from './dropbox/provider';
import { createOneDriveAdapter } from './onedrive/provider';
import type { CloudProviderAdapter } from './provider-port';

/**
 * 装配可用的服务商适配器。
 *
 * **未接入的服务商不出现在这里**，界面据 availability 只显示配置说明——
 * 不做看起来能登录、点了才失败的入口。装了适配器但没有构建期凭据（如 OneDrive 的 client id）
 * 也归到这一类：适配器自己的 `oauth()` 返回 null，界面照实说“未配置”。
 */
export function createCloudProviderAdapters(): CloudProviderAdapter[] {
  return [createDropboxAdapter(), createOneDriveAdapter()];
}
