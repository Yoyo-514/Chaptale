import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

const PermissionScopeSchema = Type.Union([Type.Literal('session'), Type.Literal('workspace'), Type.Literal('global')]);
const PersistentPermissionScopeSchema = Type.Union([Type.Literal('workspace'), Type.Literal('global')]);
const PermissionActionSchema = Type.Union([Type.Literal('allow'), Type.Literal('ask'), Type.Literal('deny')]);

const PermissionDecisionSchema = Type.Union([
  Type.Object({ outcome: Type.Literal('allow-once') }, { additionalProperties: false }),
  Type.Object(
    {
      outcome: Type.Literal('allow-always'),
      scope: PermissionScopeSchema,
      pattern: Type.String({ minLength: 1, maxLength: 500 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      outcome: Type.Literal('deny'),
      reason: Type.Optional(Type.String({ maxLength: 2000 }))
    },
    { additionalProperties: false }
  )
]);

export const PermissionsDecideArgsSchema = Type.Tuple([
  Type.Object(
    {
      requestId: Type.String({ minLength: 1 }),
      decision: PermissionDecisionSchema
    },
    { additionalProperties: false }
  )
]);
export const PermissionsDecideArgsValidator = Compile(PermissionsDecideArgsSchema);

export const PermissionsPendingArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const PermissionsPendingArgsValidator = Compile(PermissionsPendingArgsSchema);

export const PermissionsListRulesArgsSchema = Type.Tuple([]);
export const PermissionsListRulesArgsValidator = Compile(PermissionsListRulesArgsSchema);

export const PermissionsRemoveRuleArgsSchema = Type.Tuple([
  Type.Object(
    {
      scope: PersistentPermissionScopeSchema,
      pattern: Type.String({ minLength: 1, maxLength: 500 }),
      action: PermissionActionSchema
    },
    { additionalProperties: false }
  )
]);
export const PermissionsRemoveRuleArgsValidator = Compile(PermissionsRemoveRuleArgsSchema);

const RiskLevelSchema = Type.Union([Type.Literal('readonly'), Type.Literal('mutating'), Type.Literal('destructive')]);

/** 待授权请求推送事件的运行时边界；结构与 PermissionAskEvent 对齐。 */
export const PermissionAskEventSchema = Type.Object(
  {
    requestId: Type.String(),
    sessionId: Type.String(),
    toolName: Type.String(),
    riskLevel: RiskLevelSchema,
    subject: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);
export const PermissionAskEventValidator = Compile(PermissionAskEventSchema);
