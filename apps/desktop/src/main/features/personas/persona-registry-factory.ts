import path from 'node:path';

import { parseFrontmatter } from '../../core/frontmatter/parse';
import type { SettingsService } from '../../core/settings/service';
import { builtinPersonaSources } from './builtin';
import { PersonaRegistry } from './registry';

/** desktop 默认 persona 注册表：自有 frontmatter 解析 + 构建期内置 persona + 用户级目录。 */
export function createDefaultPersonaRegistry(settingsService: SettingsService): PersonaRegistry {
  return new PersonaRegistry({
    parseFrontmatter,
    builtinSources: builtinPersonaSources,
    userPersonasDir: path.join(settingsService.rootDir, 'personas')
  });
}
