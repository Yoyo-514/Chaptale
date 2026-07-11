import { describe, expect, it, vi } from 'vitest';

import { SlashCommandService } from '../slash-command.service';

import type { Skill } from '@earendil-works/pi-coding-agent';

function createSkill(name: string, description: string): Skill {
  return {
    name,
    description,
    filePath: `C:/skills/${name}/SKILL.md`,
    baseDir: `C:/skills/${name}`,
    sourceInfo: {} as Skill['sourceInfo'],
    disableModelInvocation: false
  };
}

describe('SlashCommandService', () => {
  it('lists settings and the skills available to the current workspace', async () => {
    const settingsService = {
      getCurrentCwd: vi.fn().mockResolvedValue('C:/novel')
    };
    const skillsProvider = {
      load: vi.fn().mockReturnValue({
        skills: [createSkill('review', '审查正文')],
        diagnostics: []
      })
    };
    const service = new SlashCommandService(settingsService as never, skillsProvider as never);

    await expect(service.list()).resolves.toEqual([
      {
        name: 'settings',
        description: '打开 Chaptale 设置',
        source: 'app',
        behavior: 'client-action'
      },
      {
        name: 'skill:review',
        description: '审查正文',
        argumentHint: '[任务说明]',
        source: 'skill',
        behavior: 'agent-prompt'
      }
    ]);
    expect(skillsProvider.load).toHaveBeenCalledWith('C:/novel');
  });
});
