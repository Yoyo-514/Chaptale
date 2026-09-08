import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import { WorkspaceRoleSchema } from './workspace';

const RelationSchema = Type.Object(
  {
    to: Type.String({ maxLength: 1000 }),
    type: Type.String({ maxLength: 200 }),
    note: Type.Optional(Type.String({ maxLength: 4000 }))
  },
  { additionalProperties: false }
);
export const AssetFieldValueSchema = Type.Union([
  Type.Null(),
  Type.String({ maxLength: 40_000 }),
  Type.Number(),
  Type.Boolean(),
  Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 200 }),
  Type.Array(RelationSchema, { maxItems: 200 })
]);
export type AssetFieldValue = Static<typeof AssetFieldValueSchema>;
export const AssetFieldsSchema = Type.Record(
  Type.String({ pattern: '^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$' }),
  AssetFieldValueSchema
);
export const TemplateFieldSchema = Type.Object(
  {
    key: Type.String({ pattern: '^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$' }),
    label: Type.String({ minLength: 1, maxLength: 100 }),
    type: Type.Union([
      Type.Literal('text'),
      Type.Literal('textarea'),
      Type.Literal('select'),
      Type.Literal('tags'),
      Type.Literal('number'),
      Type.Literal('date'),
      Type.Literal('link'),
      Type.Literal('relations'),
      Type.Literal('checkbox')
    ]),
    required: Type.Optional(Type.Boolean()),
    options: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 100 })),
    targetKind: Type.Optional(Type.String({ maxLength: 100 })),
    default: Type.Optional(AssetFieldValueSchema)
  },
  { additionalProperties: false }
);
export type TemplateField = Static<typeof TemplateFieldSchema>;
export const TemplateHeaderSchema = Type.Object(
  {
    template: Type.String({ pattern: '^[a-z][a-z0-9-]{0,79}$' }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    targetKind: Type.String({ pattern: '^[a-z][a-z0-9-]{0,79}$' }),
    targetRole: WorkspaceRoleSchema,
    fields: Type.Array(TemplateFieldSchema, { minItems: 1, maxItems: 40 })
  },
  { additionalProperties: false }
);
export const TemplateHeaderValidator = Compile(TemplateHeaderSchema);
export type AssetTemplate = Static<typeof TemplateHeaderSchema> & {
  body: string;
  hash: string;
  source: 'builtin' | 'user' | 'workspace';
  sourcePath: string;
};
export type TemplateList = { templates: AssetTemplate[]; diagnostics: string[] };

export function templateSubdirectory(templateId: string) {
  if (templateId === 'scene-card') return '/场景卡';
  if (templateId === 'story-event') return '/时间线';
  return '';
}

export function templateDefaults(template: AssetTemplate): Record<string, AssetFieldValue> {
  return Object.fromEntries(
    template.fields.filter(field => field.default !== undefined).map(field => [field.key, field.default!])
  );
}
export function validateTemplateValues(
  template: AssetTemplate,
  values: Record<string, AssetFieldValue>,
  creating = true
) {
  const errors: string[] = [];
  for (const key of Object.keys(values)) {
    if (!template.fields.some(field => field.key === key)) errors.push(`模板未声明字段：${key}`);
  }
  for (const field of template.fields) {
    const value = values[field.key];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      if (creating && field.required) errors.push(`${field.label}不能为空`);
      continue;
    }
    const valid =
      field.type === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : field.type === 'checkbox'
          ? typeof value === 'boolean'
          : field.type === 'tags'
            ? Array.isArray(value) && value.every(item => typeof item === 'string')
            : field.type === 'relations'
              ? Array.isArray(value) &&
                value.every(
                  item =>
                    item && typeof item === 'object' && typeof item.to === 'string' && typeof item.type === 'string'
                )
              : typeof value === 'string';
    if (!valid) errors.push(`${field.label}的字段类型不匹配`);
  }
  return errors;
}
export function matchAssetTemplate(templates: readonly AssetTemplate[], head: Record<string, unknown>) {
  const explicit = head.templateId ?? head.template;
  const selected = templates.find(template => template.template === explicit && template.targetKind === head.kind);
  if (selected) return selected;
  const kind = head.kind;
  const candidates = templates.filter(template => template.targetKind === kind);
  return (
    candidates.find(template =>
      template.fields.some(
        field => ['importance', 'category', 'level'].includes(field.key) && field.default === head[field.key]
      )
    ) ?? candidates[0]
  );
}
