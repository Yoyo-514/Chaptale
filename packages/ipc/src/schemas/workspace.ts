import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

import { MAX_DOCUMENT_BYTES } from '../workspace';

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

export const ReadDocumentArgsSchema = Type.Object(
  {
    /** 仅校验工作区身份，不作为读取根目录；真正的根目录仍取自 Main 设置。 */
    rootPath: Type.String({ minLength: 1 }),
    relativePath: Type.String({
      minLength: 1,
      pattern: '^(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/\\\\:\\x00]+(?:/[^/\\\\:\\x00]+)*$'
    }),
    /** 调用方可收紧读取预算，不能放宽 Main 上限。 */
    maxBytes: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_DOCUMENT_BYTES }))
  },
  { additionalProperties: false }
);
export const ReadDocumentArgsValidator = Compile(Type.Tuple([ReadDocumentArgsSchema]));

export const WriteDocumentArgsSchema = Type.Object(
  {
    rootPath: ReadDocumentArgsSchema.properties.rootPath,
    relativePath: ReadDocumentArgsSchema.properties.relativePath,
    expectedHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    content: Type.String({ maxLength: MAX_DOCUMENT_BYTES })
  },
  { additionalProperties: false }
);
export const WriteDocumentArgsValidator = Compile(Type.Tuple([WriteDocumentArgsSchema]));

export const WorkspaceRootArgsSchema = Type.Object(
  { rootPath: ReadDocumentArgsSchema.properties.rootPath },
  { additionalProperties: false }
);
export const WorkspaceRootArgsValidator = Compile(Type.Tuple([WorkspaceRootArgsSchema]));
export const CreateChapterArgsSchema = Type.Object(
  {
    rootPath: ReadDocumentArgsSchema.properties.rootPath,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    filename: Type.String({ minLength: 1, maxLength: 160 }),
    order: Type.Integer({ minimum: 1, maximum: 1000000 }),
    relativeDirectory: Type.Optional(ReadDocumentArgsSchema.properties.relativePath)
  },
  { additionalProperties: false }
);
export const CreateChapterArgsValidator = Compile(Type.Tuple([CreateChapterArgsSchema]));
