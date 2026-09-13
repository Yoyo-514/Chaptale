import { createDropboxAdapter } from './dropbox/provider';
import type { CloudProviderAdapter } from './provider-port';

/**
 * 装配可用的服务商适配器。
 *
 * 适配器按 S1 的步骤逐个接入（Dropbox → OneDrive → 坚果云）。**未接入的服务商不出现在这里**，
 * 界面据 availability 只显示配置说明——不做看起来能登录、点了才失败的入口。
 */
export function createCloudProviderAdapters(): CloudProviderAdapter[] {
  return [createDropboxAdapter()];
}
