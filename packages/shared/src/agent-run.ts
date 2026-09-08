import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import { TokenUsageSchema } from './token-usage';

export const AgentRunStatusSchema = Type.Union([
  Type.Literal('success'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('timeout')
]);
export const AgentRunUsageSchema = TokenUsageSchema;
export const AgentRunInputDigestSchema = Type.Object(
  {
    brief: Type.Optional(Type.String()),
    files: Type.Optional(Type.Array(Type.String())),
    packId: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);
/** 旧记录允许缺少模型与输出指纹；缺失值不能被解释为已验证。 */
export const AgentRunRecordSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    personaId: Type.String({ minLength: 1 }),
    execution: Type.Union([Type.Literal('chat'), Type.Literal('task')]),
    trigger: Type.Union([Type.Literal('user'), Type.Literal('delegate'), Type.Literal('ui-action')]),
    parentSessionId: Type.Optional(Type.String()),
    promptTemplateHash: Type.String(),
    model: Type.Optional(
      Type.Object({ provider: Type.String(), modelId: Type.String() }, { additionalProperties: false })
    ),
    cachePolicy: Type.Optional(
      Type.Union([
        Type.Literal('provider-default'),
        Type.Literal('openai-automatic'),
        Type.Literal('openai-explicit'),
        Type.Literal('anthropic')
      ])
    ),
    inputDigest: AgentRunInputDigestSchema,
    outputRef: Type.Optional(Type.String()),
    outputHash: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
    memoryRefs: Type.Array(Type.String()),
    status: AgentRunStatusSchema,
    usage: AgentRunUsageSchema,
    createdAt: Type.String(),
    completedAt: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);
export const AgentRunRecordValidator = Compile(AgentRunRecordSchema);
export type AgentRunRecord = Static<typeof AgentRunRecordSchema>;
export type AgentRunUsage = Static<typeof AgentRunUsageSchema>;
export type AgentRunInputDigest = Static<typeof AgentRunInputDigestSchema>;
export type AgentRunExecution = AgentRunRecord['execution'];
export type AgentRunTrigger = AgentRunRecord['trigger'];
export type AgentRunStatus = AgentRunRecord['status'];
