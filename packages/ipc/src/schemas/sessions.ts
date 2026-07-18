import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

export const CreateSessionOptionsSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
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

export const SessionIdArgsSchema = Type.Tuple([Type.String()]);
export const SessionIdArgsValidator = Compile(SessionIdArgsSchema);

export const ReadSessionImagePayloadSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('session-entry'),
      sessionId: Type.String(),
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
    sessionId: Type.String(),
    name: Type.String()
  },
  { additionalProperties: false }
);

export const RenameSessionArgsSchema = Type.Tuple([RenameSessionPayloadSchema]);
export const RenameSessionArgsValidator = Compile(RenameSessionArgsSchema);

export const ExportSessionPayloadSchema = Type.Object({ sessionId: Type.String() }, { additionalProperties: false });
export const ExportSessionArgsSchema = Type.Tuple([ExportSessionPayloadSchema]);
export const ExportSessionArgsValidator = Compile(ExportSessionArgsSchema);

export const DeleteSessionPayloadSchema = Type.Object({ sessionId: Type.String() }, { additionalProperties: false });
export const DeleteSessionArgsSchema = Type.Tuple([DeleteSessionPayloadSchema]);
export const DeleteSessionArgsValidator = Compile(DeleteSessionArgsSchema);

export const DeleteSessionsPayloadSchema = Type.Object(
  { sessionIds: Type.Array(Type.String()) },
  { additionalProperties: false }
);
export const DeleteSessionsArgsSchema = Type.Tuple([DeleteSessionsPayloadSchema]);
export const DeleteSessionsArgsValidator = Compile(DeleteSessionsArgsSchema);

export const SetSessionLeafPayloadSchema = Type.Object(
  {
    sessionId: Type.String(),
    leafId: Type.Union([Type.String(), Type.Null()])
  },
  { additionalProperties: false }
);
export const SetSessionLeafArgsSchema = Type.Tuple([SetSessionLeafPayloadSchema]);
export const SetSessionLeafArgsValidator = Compile(SetSessionLeafArgsSchema);
