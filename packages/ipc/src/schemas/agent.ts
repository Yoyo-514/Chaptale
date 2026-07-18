import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

export const AgentStartPayloadSchema = Type.Object(
  {
    runId: Type.String(),
    query: Type.String(),
    sessionId: Type.Optional(Type.String()),
    branchFromEntryId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    contextFilePaths: Type.Optional(Type.Array(Type.String())),
    reuseUserEntryId: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

export const AgentStartArgsSchema = Type.Tuple([AgentStartPayloadSchema]);
export const AgentStartArgsValidator = Compile(AgentStartArgsSchema);

export const AgentCancelArgsSchema = Type.Tuple([Type.String()]);
export const AgentCancelArgsValidator = Compile(AgentCancelArgsSchema);

export const AgentInspectContextFilesArgsSchema = Type.Tuple([Type.Array(Type.String())]);
export const AgentInspectContextFilesArgsValidator = Compile(AgentInspectContextFilesArgsSchema);
