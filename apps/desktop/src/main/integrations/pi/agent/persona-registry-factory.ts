import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import path from 'node:path';

import { builtinPersonaSources } from '../../../modules/personas/builtin';
import { PersonaRegistry } from '../../../modules/personas/registry';
import type { SettingsService } from '../../../modules/settings/service';

/** desktop 默认 persona 注册表：pi frontmatter 解析 + 构建期内置 persona + 用户级目录。 */
export function createDefaultPersonaRegistry(settingsService: SettingsService): PersonaRegistry {
  return new PersonaRegistry({
    parseFrontmatter,
    builtinSources: builtinPersonaSources,
    userPersonasDir: path.join(settingsService.rootDir, 'personas')
  });
}
