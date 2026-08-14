import type { UpdateWebToolsSettingsPayload, WebToolsSettings } from '@chaptale/ipc-contract';

import { mergeWebToolsSettings } from '../../core/settings/defaults';
import type { WebToolsAdapter } from '../../core/settings/web-tools-adapter';
import { normalizeSettings } from './settings';

/** 将设置模块端口适配到 web-tools.json 配置格式（读写与合并均复用域内纯函数）。 */
export class WebToolsSettingsAdapter implements WebToolsAdapter {
  fromConfig(config: Record<string, unknown>): UpdateWebToolsSettingsPayload {
    // 读取场景直接返回完整快照形状（多余字段对合并无影响，见 mergeUpdate）。
    const normalized = normalizeSettings(config);
    return {
      search: { ...normalized.search },
      keys: { ...normalized.keys },
      fetch: { ...normalized.fetch },
      ssrf: { allowRanges: normalized.ssrf.allowRanges }
    };
  }

  mergeUpdate(current: WebToolsSettings, payload: UpdateWebToolsSettingsPayload): WebToolsSettings {
    return mergeWebToolsSettings(current, payload);
  }

  toConfig(settings: WebToolsSettings): Record<string, unknown> {
    return { ...settings };
  }
}
