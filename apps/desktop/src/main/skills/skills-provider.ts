import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import path from 'node:path';

import type { LoadSkillsResult, Skill } from '@earendil-works/pi-coding-agent';
import type { SettingsService } from '../services/settings.service';

export class SkillsProvider {
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
