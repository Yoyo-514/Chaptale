import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

export const EditCommandSchema = Type.Union([
  Type.Literal('undo'),
  Type.Literal('redo'),
  Type.Literal('cut'),
  Type.Literal('copy'),
  Type.Literal('paste'),
  Type.Literal('selectAll')
]);
export type EditCommand = Static<typeof EditCommandSchema>;
export const EditCommandValidator = Compile(Type.Tuple([EditCommandSchema]));

export type AppPlatformResult = {
  platform: string;
  versions: Record<string, string>;
};
