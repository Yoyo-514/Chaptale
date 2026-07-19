import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

/** persona 类型：决定它在创作流程中的职责定位。 */
export const personaTypes = ['chat', 'plan', 'draft', 'review', 'rewrite', 'research', 'custom'] as const;

/** 执行形态：chat 为多轮对话；task 为一次性结构化执行（M1/A2 起支持）。 */
export const personaExecutions = ['chat', 'task'] as const;

/** persona 来源层级；优先级 workspace > user > builtin，同 id 覆盖。 */
export const personaSources = ['builtin', 'user', 'workspace'] as const;

/**
 * persona 定义文件的 frontmatter 契约（01 设计文档 §3.1）。
 *
 * 扩展点原则：字段只增不改（04 文档 §3）；A0 先落必需子集，
 * model/tools/skills/memory/output 等字段随 A2/B0 里程碑启用但 schema 先行，
 * 保证早期用户文件在后续版本零迁移。
 */
export const PersonaFrontmatterSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: 64 }),
    type: Type.Union(personaTypes.map(value => Type.Literal(value))),
    execution: Type.Union(personaExecutions.map(value => Type.Literal(value))),
    model: Type.Optional(Type.Object({ preference: Type.String({ minLength: 1 }) }, { additionalProperties: false })),
    tools: Type.Optional(Type.Array(Type.String())),
    skills: Type.Optional(Type.Array(Type.String())),
    memory: Type.Optional(
      Type.Object(
        {
          read: Type.Optional(Type.Array(Type.String())),
          write: Type.Optional(Type.Array(Type.String())),
          propose: Type.Optional(Type.Array(Type.String()))
        },
        { additionalProperties: false }
      )
    ),
    output: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean({ default: true }))
  },
  { additionalProperties: false }
);

export const PersonaFrontmatterValidator = Compile(PersonaFrontmatterSchema);

export type PersonaFrontmatter = Static<typeof PersonaFrontmatterSchema>;
export type PersonaSource = (typeof personaSources)[number];

/** registry 解析完成后的 persona 定义：frontmatter + 正文（系统提示词模板）+ 来源。 */
export type PersonaDefinition = PersonaFrontmatter & {
  /** persona 文件正文，即该 persona 的系统提示词（模板）。 */
  body: string;
  source: PersonaSource;
  /** 磁盘来源文件路径；builtin 为空（构建期打包）。 */
  filePath?: string;
};

/** persona 文件解析失败时的诊断信息；非法文件不崩溃、不注册，仅记录。 */
export type PersonaDiagnostic = {
  source: PersonaSource;
  filePath?: string;
  message: string;
};
