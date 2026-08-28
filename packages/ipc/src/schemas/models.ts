import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 模型设置 IPC 的运行时 schema；业务级非空、范围和资源存在性由主进程服务继续校验。 */
export const ChaptaleModelInputSchema = Type.Union([Type.Literal('text'), Type.Literal('image')]);

export const ChaptaleCustomProviderApiSchema = Type.Union([
  Type.Literal('openai-completions'),
  Type.Literal('openai-responses'),
  Type.Literal('anthropic-messages'),
  Type.Literal('google-generative-ai')
]);

export const SetDefaultModelPayloadSchema = Type.Object(
  {
    provider: Type.String(),
    modelId: Type.String()
  },
  { additionalProperties: false }
);
export const SetDefaultModelArgsSchema = Type.Tuple([SetDefaultModelPayloadSchema]);
export const SetDefaultModelArgsValidator = Compile(SetDefaultModelArgsSchema);

export const FetchCustomProviderModelsPayloadSchema = Type.Object(
  {
    provider: Type.Optional(Type.String()),
    baseUrl: Type.Optional(Type.String()),
    api: Type.Optional(ChaptaleCustomProviderApiSchema),
    apiKey: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);
export const FetchCustomProviderModelsArgsSchema = Type.Tuple([FetchCustomProviderModelsPayloadSchema]);
export const FetchCustomProviderModelsArgsValidator = Compile(FetchCustomProviderModelsArgsSchema);

/**
 * 推理档位：AI SDK 的顶层 `reasoning` 参数，由它翻译成各 provider 的原生表达
 * （OpenAI 的 reasoning_effort、Anthropic 的 thinking budget、Google 的 thinkingBudget……）。
 *
 * 不收 SDK 那个 `'provider-default'`：它与「不填」行为完全一致，
 * 而 maxTokens / temperature / topP 已经确立了「空 = 服务端默认」的惯例，
 * 两种写法表达同一件事只会让界面多一个要解释的选项。
 */
export const ChaptaleReasoningEffortSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh')
]);

export const ModelParamsSchema = {
  maxTokens: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
  topP: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  reasoningEffort: Type.Optional(ChaptaleReasoningEffortSchema)
};

export const AddCustomProviderModelPayloadSchema = Type.Object(
  {
    modelId: Type.String(),
    modelName: Type.Optional(Type.String()),
    input: Type.Array(ChaptaleModelInputSchema),
    contextWindow: Type.Optional(Type.Number()),
    ...ModelParamsSchema
  },
  { additionalProperties: false }
);

export const AddCustomProviderPayloadSchema = Type.Object(
  {
    provider: Type.String(),
    providerName: Type.String(),
    baseUrl: Type.String(),
    api: ChaptaleCustomProviderApiSchema,
    apiKey: Type.Optional(Type.String()),
    models: Type.Array(AddCustomProviderModelPayloadSchema)
  },
  { additionalProperties: false }
);
export const AddCustomProviderArgsSchema = Type.Tuple([AddCustomProviderPayloadSchema]);
export const AddCustomProviderArgsValidator = Compile(AddCustomProviderArgsSchema);

export const AddCustomModelPayloadSchema = Type.Object(
  {
    provider: Type.String(),
    modelId: Type.String(),
    modelName: Type.Optional(Type.String()),
    input: Type.Array(ChaptaleModelInputSchema),
    contextWindow: Type.Optional(Type.Number()),
    ...ModelParamsSchema
  },
  { additionalProperties: false }
);
export const AddCustomModelArgsSchema = Type.Tuple([AddCustomModelPayloadSchema]);
export const AddCustomModelArgsValidator = Compile(AddCustomModelArgsSchema);

export const SetCustomProviderApiKeyPayloadSchema = Type.Object(
  {
    provider: Type.String(),
    apiKey: Type.String()
  },
  { additionalProperties: false }
);
export const SetCustomProviderApiKeyArgsSchema = Type.Tuple([SetCustomProviderApiKeyPayloadSchema]);
export const SetCustomProviderApiKeyArgsValidator = Compile(SetCustomProviderApiKeyArgsSchema);

export const RemoveCustomProviderApiKeyPayloadSchema = Type.Object(
  { provider: Type.String() },
  { additionalProperties: false }
);
export const RemoveCustomProviderApiKeyArgsSchema = Type.Tuple([RemoveCustomProviderApiKeyPayloadSchema]);
export const RemoveCustomProviderApiKeyArgsValidator = Compile(RemoveCustomProviderApiKeyArgsSchema);

export const UpdateCustomModelInputPayloadSchema = Type.Object(
  {
    provider: Type.String(),
    modelId: Type.String(),
    input: Type.Array(ChaptaleModelInputSchema)
  },
  { additionalProperties: false }
);
export const UpdateCustomModelInputArgsSchema = Type.Tuple([UpdateCustomModelInputPayloadSchema]);
export const UpdateCustomModelInputArgsValidator = Compile(UpdateCustomModelInputArgsSchema);

export const RemoveCustomModelPayloadSchema = Type.Object(
  {
    provider: Type.String(),
    modelId: Type.String()
  },
  { additionalProperties: false }
);
export const RemoveCustomModelArgsSchema = Type.Tuple([RemoveCustomModelPayloadSchema]);
export const RemoveCustomModelArgsValidator = Compile(RemoveCustomModelArgsSchema);
