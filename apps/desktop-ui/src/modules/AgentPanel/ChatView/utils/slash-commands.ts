import type { SlashCommand } from '@chaptale/ipc-contract';
import { parseSkillInvocation } from '@chaptale/shared';

export function getSlashCommandName(input: string) {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return undefined;
  }

  return trimmed.slice(1).split(/\s/, 1)[0];
}

export function findSlashCommand(input: string, commands: SlashCommand[]) {
  const name = getSlashCommandName(input);
  return name ? commands.find(command => command.name === name) : undefined;
}

export const parseSkillSlashCommand = parseSkillInvocation;
