import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/**
 * 会话标识符边界：只允许安全字符集（UUID / 测试短 id），
 * 拒绝路径分隔符与点段，阻断经 sessionId 拼接会话文件路径时的穿越。
 */
export const SessionIdSchema = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' });

/** 会话 IPC 的运行时结构校验；条目存在性、删除路径安全与图片读取约束由对应的主进程处理逻辑分别验证。 */
export const CreateSessionOptionsSchema = Type.Object(
  {
    id: Type.Optional(SessionIdSchema),
    name: Type.Optional(Type.String()),
    cwd: Type.Optional(Type.String()),
    parentSessionPath: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

export const CreateSessionArgsSchema = Type.Union([
  Type.Tuple([]),
  Type.Tuple([Type.Union([CreateSessionOptionsSchema, Type.Undefined()])])
]);
export const CreateSessionArgsValidator = Compile(CreateSessionArgsSchema);

export const SessionIdArgsSchema = Type.Tuple([SessionIdSchema]);
export const SessionIdArgsValidator = Compile(SessionIdArgsSchema);

export const ReadSessionImagePayloadSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('session-entry'),
      sessionId: SessionIdSchema,
      entryId: Type.String(),
      blockIndex: Type.Number()
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal('context-file'),
      path: Type.String()
    },
    { additionalProperties: false }
  )
]);

export const ReadSessionImageArgsSchema = Type.Tuple([ReadSessionImagePayloadSchema]);
export const ReadSessionImageArgsValidator = Compile(ReadSessionImageArgsSchema);

export const RenameSessionPayloadSchema = Type.Object(
  {
    sessionId: SessionIdSchema,
    name: Type.String()
  },
  { additionalProperties: false }
);

export const RenameSessionArgsSchema = Type.Tuple([RenameSessionPayloadSchema]);
export const RenameSessionArgsValidator = Compile(RenameSessionArgsSchema);

export const ExportSessionPayloadSchema = Type.Object({ sessionId: SessionIdSchema }, { additionalProperties: false });
export const ExportSessionArgsSchema = Type.Tuple([ExportSessionPayloadSchema]);
export const ExportSessionArgsValidator = Compile(ExportSessionArgsSchema);

export const DeleteSessionPayloadSchema = Type.Object({ sessionId: SessionIdSchema }, { additionalProperties: false });
export const DeleteSessionArgsSchema = Type.Tuple([DeleteSessionPayloadSchema]);
export const DeleteSessionArgsValidator = Compile(DeleteSessionArgsSchema);

export const DeleteSessionsPayloadSchema = Type.Object(
  { sessionIds: Type.Array(SessionIdSchema) },
  { additionalProperties: false }
);
export const DeleteSessionsArgsSchema = Type.Tuple([DeleteSessionsPayloadSchema]);
export const DeleteSessionsArgsValidator = Compile(DeleteSessionsArgsSchema);

export const SetSessionLeafPayloadSchema = Type.Object(
  {
    sessionId: SessionIdSchema,
    leafId: Type.Union([Type.String(), Type.Null()])
  },
  { additionalProperties: false }
);
export const SetSessionLeafArgsSchema = Type.Tuple([SetSessionLeafPayloadSchema]);
export const SetSessionLeafArgsValidator = Compile(SetSessionLeafArgsSchema);
