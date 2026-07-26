import type { SlashCommand } from '@chaptale/ipc-contract';

import type { SettingsService } from '../../core/settings/service';
import type { SkillProvider } from '../skills/provider';

const SETTINGS_COMMAND: SlashCommand = {
  name: 'settings',
  description: '打开 Chaptale 设置',
  source: 'app',
  behavior: 'client-action'
};

/** 聚合应用内置命令与 Skill 命令描述，供调用方展示；不解析或执行任何命令。 */
export class SlashCommandService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly skillsProvider: SkillProvider
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
