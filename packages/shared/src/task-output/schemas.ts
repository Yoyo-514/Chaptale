import { Type, type Static, type TSchema } from 'typebox';
import { Check, Errors } from 'typebox/value';

/**
 * 任务输出 schema 注册表。
 *
 * task 型 persona 的结构化输出按 schema id 校验；注册表集中管理
 * 所有输出契约，运行时通过 id 查找并校验，避免各调用方散落
 * 自己的校验逻辑。
 */
const outputSchemaRegistry = new Map<string, TSchema>();

/** 注册一个输出 schema；同 id 重复注册时后注册者覆盖前者。 */
export function registerOutputSchema(id: string, schema: TSchema): void {
  outputSchemaRegistry.set(id, schema);
}

/** 按 id 查找已注册的输出 schema；未注册返回 undefined。 */
export function getOutputSchema(id: string): TSchema | undefined {
  return outputSchemaRegistry.get(id);
}

/**
 * 连续性问题清单的输出契约：审校类任务产出的问题列表 + 总结。
 */
export const ContinuityIssuesSchema = Type.Object(
  {
    issues: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          // 显式元组写法：.map() 产生普通数组会让 Static 丢失字面量联合类型。
          severity: Type.Union([Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')]),
          location: Type.String(),
          description: Type.String(),
          suggestion: Type.Optional(Type.String())
        },
        { additionalProperties: false }
      )
    ),
    summary: Type.String()
  },
  { additionalProperties: false }
);

export type ContinuityIssues = Static<typeof ContinuityIssuesSchema>;

registerOutputSchema('continuity-issues', ContinuityIssuesSchema);

/** 校验结果：成功携带（类型收窄后的）值，失败携带人类可读的错误列表。 */
export type OutputValidationResult = { ok: true; value: unknown } | { ok: false; errors: string[] };

/**
 * 按 schema id 校验一个任务输出值。
 *
 * schema 未注册也归入失败分支（而非抛异常），让调用方统一走
 * 错误处理路径；错误信息带上出错路径，便于反馈给模型重试。
 */
export function validateOutput(schemaId: string, value: unknown): OutputValidationResult {
  const schema = getOutputSchema(schemaId);
  if (!schema) {
    return { ok: false, errors: [`未注册的输出 schema：${schemaId}`] };
  }

  if (Check(schema, value)) {
    return { ok: true, value };
  }

  const errors = Errors(schema, value).map(error => {
    const path = error.instancePath === '' ? '(root)' : error.instancePath;
    return `${path}: ${error.message}`;
  });
  return { ok: false, errors };
}
