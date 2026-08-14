import type { UpdateWebToolsSettingsPayload, WebToolsSettings } from '@chaptale/ipc-contract';

/** 设置模块只依赖此端口，不感知 web-tools 域的配置文件映射实现。 */
export interface WebToolsAdapter {
  fromConfig(config: Record<string, unknown>): UpdateWebToolsSettingsPayload;
  mergeUpdate(current: WebToolsSettings, payload: UpdateWebToolsSettingsPayload): WebToolsSettings;
  toConfig(settings: WebToolsSettings): Record<string, unknown>;
}
