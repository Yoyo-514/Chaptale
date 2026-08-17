import path from 'node:path';

import { loadSkillsFromDir, skillAppliesTo } from '../../core/agent/skills';
import type { SettingsService } from '../../core/settings/service';
import type { SkillLoadResult, SkillProvider } from './provider-port';

/**
 * 自有 SkillsProvider：三层目录（builtin < 用户 < 工作区）同名覆盖 + appliesTo 过滤。
 * 同名覆盖后过滤以最终生效文件的声明为准。
 */
export class SkillsProvider implements SkillProvider {
  constructor(private readonly settingsService: SettingsService) {}

  async load(cwd: string, personaId?: string): Promise<SkillLoadResult> {
    const [builtin, user, workspace] = await Promise.all([
      loadSkillsFromDir(this.settingsService.builtinSkillsDir, 'builtin'),
      loadSkillsFromDir(path.join(this.settingsService.rootDir, 'skills'), 'user'),
      loadSkillsFromDir(path.join(cwd, '.chaptale', 'skills'), 'project')
    ]);

    // 同名覆盖次序：内置 < 用户级 < 作品级。
    const skillsByName = new Map<string, (typeof builtin.skills)[number]>();

    for (const skill of [...builtin.skills, ...user.skills, ...workspace.skills]) {
      skillsByName.set(skill.name, skill);
    }

    const merged = [...skillsByName.values()];

    return {
      skills: personaId ? merged.filter(skill => skillAppliesTo(skill.appliesTo, personaId)) : merged
    };
  }
}
