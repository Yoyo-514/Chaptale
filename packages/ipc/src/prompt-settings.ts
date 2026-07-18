import type { Static } from 'typebox';
import type { UpdatePromptSettingsPayloadSchema } from './schemas/prompts';

export type PromptSettingsState = {
  systemPrompt: string;
  appendSystemPrompt: string;
  defaultSystemPrompt: string;
  systemPromptPath: string;
  appendSystemPromptPath: string;
};

export type UpdatePromptSettingsPayload = Static<typeof UpdatePromptSettingsPayloadSchema>;
