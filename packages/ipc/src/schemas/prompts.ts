import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

export const UpdatePromptSettingsPayloadSchema = Type.Object(
  {
    systemPrompt: Type.String(),
    appendSystemPrompt: Type.String()
  },
  { additionalProperties: false }
);

export const UpdatePromptSettingsArgsSchema = Type.Tuple([UpdatePromptSettingsPayloadSchema]);
export const UpdatePromptSettingsArgsValidator = Compile(UpdatePromptSettingsArgsSchema);
