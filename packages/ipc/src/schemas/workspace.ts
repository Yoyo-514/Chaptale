import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 空串为根目录；其他值必须是无穿越、无空段的正斜杠相对路径。 */
export const ListDirectoryArgsSchema = Type.Object(
  {
    relativePath: Type.String({ pattern: '^(?!.*(?:^|/)\\.\\.(?:/|$))(?!/)(?!.*//)[^\\\\:\\x00]*$' }),
    includeInternal: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
export const ListDirectoryArgsValidator = Compile(Type.Tuple([ListDirectoryArgsSchema]));
export const WorkspaceGetStateArgsValidator = Compile(Type.Tuple([]));
