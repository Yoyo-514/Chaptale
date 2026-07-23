import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

const PermissionScopeSchema = Type.Union([Type.Literal('session'), Type.Literal('workspace'), Type.Literal('global')]);

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
