import type { PiWebAccessSettings, UpdatePiWebAccessSettingsPayload } from '@chaptale/ipc-contract';

/** 设置模块只依赖此端口，不感知 Pi 的配置字段映射实现。 */
export interface WebAccessAdapter {
  fromConfig(config: Record<string, unknown>): UpdatePiWebAccessSettingsPayload;
  mergeUpdate(current: PiWebAccessSettings, payload: UpdatePiWebAccessSettingsPayload): PiWebAccessSettings;
  toConfig(settings: PiWebAccessSettings): Record<string, unknown>;
}
