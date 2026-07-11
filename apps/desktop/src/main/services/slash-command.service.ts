import type { SlashCommand } from '@chaptale/ipc-contract';

import type { SettingsService } from './settings.service';
import type { SkillsProvider } from '../skills/skills-provider';

const SETTINGS_COMMAND: SlashCommand = {
  name: 'settings',
  description: '打开 Chaptale 设置',
  source: 'app',
  behavior: 'client-action'
};

export class SlashCommandService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly skillsProvider: SkillsProvider
  ) {}

  async list(): Promise<SlashCommand[]> {
    const cwd = await this.settingsService.getCurrentCwd();
    const { skills } = this.skillsProvider.load(cwd);

    return [
      SETTINGS_COMMAND,
      ...skills.map(
        skill =>
          ({
            name: `skill:${skill.name}`,
            description: skill.description,
            argumentHint: '[任务说明]',
            source: 'skill',
            behavior: 'agent-prompt'
          }) satisfies SlashCommand
      )
    ];
  }
}
