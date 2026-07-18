import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import path from 'node:path';

import type { LoadSkillsResult, Skill } from '@earendil-works/pi-coding-agent';
import type { SkillProvider } from '../../../modules/skills/provider';
import type { SettingsService } from '../../../modules/settings/service';

/** 使用 pi loader 读取磁盘 Skill，并只向应用层暴露稳定的 SkillProvider 能力。 */
export class SkillsProvider implements SkillProvider {
  constructor(private readonly settingsService: SettingsService) {}

  load(cwd: string): LoadSkillsResult {
    const user = loadSkillsFromDir({
      dir: path.join(this.settingsService.rootDir, 'skills'),
      source: 'user'
    });
    const workspace = loadSkillsFromDir({
      dir: path.join(cwd, '.chaptale', 'skills'),
      source: 'project'
    });
    const skillsByName = new Map<string, Skill>();

    for (const skill of [...user.skills, ...workspace.skills]) {
      if (isValidSkillName(skill.name)) {
        skillsByName.set(skill.name, skill);
      }
    }

    return {
      skills: [...skillsByName.values()],
      diagnostics: [...user.diagnostics, ...workspace.diagnostics]
    };
  }
}

function isValidSkillName(name: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
}
