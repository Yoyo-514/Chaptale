import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import path from 'node:path';

import type { SettingsService } from '../../../core/settings/service';
import { builtinPersonaSources } from '../../../features/personas/builtin';
import { PersonaRegistry } from '../../../features/personas/registry';

/** desktop 默认 persona 注册表：pi frontmatter 解析 + 构建期内置 persona + 用户级目录。 */
export function createDefaultPersonaRegistry(settingsService: SettingsService): PersonaRegistry {
  return new PersonaRegistry({
    parseFrontmatter,
    builtinSources: builtinPersonaSources,
    userPersonasDir: path.join(settingsService.rootDir, 'personas')
  });
}
