export type SlashCommandSource = 'app' | 'skill';

export type SlashCommandBehavior = 'client-action' | 'agent-prompt';

export type SlashCommand = {
  name: string;
  description: string;
  argumentHint?: string;
  source: SlashCommandSource;
  behavior: SlashCommandBehavior;
};
