export type PromptSettingsState = {
  systemPrompt: string;
  appendSystemPrompt: string;
  defaultSystemPrompt: string;
  systemPromptPath: string;
  appendSystemPromptPath: string;
};

export type UpdatePromptSettingsPayload = {
  systemPrompt: string;
  appendSystemPrompt: string;
};
