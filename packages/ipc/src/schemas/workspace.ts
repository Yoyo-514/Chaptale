import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 无穿越、无空段、无盘符与反斜杠的正斜杠相对路径；空串代表工作区根。 */
const WORKSPACE_RELATIVE_PATH_PATTERN = '^(?!.*(?:^|/)\\.\\.(?:/|$))(?!/)(?!.*//)[^\\\\:\\x00]*$';

/** 空串为根目录；其他值必须是无穿越、无空段的正斜杠相对路径。 */
export const ListDirectoryArgsSchema = Type.Object(
  {
    relativePath: Type.String({ pattern: WORKSPACE_RELATIVE_PATH_PATTERN }),
    includeInternal: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
export const ListDirectoryArgsValidator = Compile(Type.Tuple([ListDirectoryArgsSchema]));
export const WorkspaceGetStateArgsValidator = Compile(Type.Tuple([]));

/** 新建目标必须指向工作区内某个具体条目；根目录已经存在，不接受空串。 */
export const CreateEntryArgsSchema = Type.Object(
  {
    relativePath: Type.String({ pattern: WORKSPACE_RELATIVE_PATH_PATTERN, minLength: 1 }),
    kind: Type.Union([Type.Literal('file'), Type.Literal('directory')])
  },
  { additionalProperties: false }
);
export const CreateEntryArgsValidator = Compile(Type.Tuple([CreateEntryArgsSchema]));
