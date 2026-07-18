import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

export const ChaptaleStorageModeSchema = Type.Union([Type.Literal('global'), Type.Literal('workspace')]);

const ChaptaleStorageSettingsUpdateSchema = Type.Object(
  {
    mode: Type.Optional(ChaptaleStorageModeSchema),
    workspacePath: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

export const UpdateChaptaleSettingsPayloadSchema = Type.Object(
  {
    storage: Type.Optional(ChaptaleStorageSettingsUpdateSchema),
    lastSessionId: Type.Optional(Type.Union([Type.String(), Type.Null()]))
  },
  { additionalProperties: false }
);

export const UpdateChaptaleSettingsArgsSchema = Type.Tuple([UpdateChaptaleSettingsPayloadSchema]);
export const UpdateChaptaleSettingsArgsValidator = Compile(UpdateChaptaleSettingsArgsSchema);

export const PiWebAccessProviderSchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('openai'),
  Type.Literal('brave'),
  Type.Literal('parallel'),
  Type.Literal('tavily'),
  Type.Literal('exa'),
  Type.Literal('perplexity'),
  Type.Literal('gemini')
]);

export const PiWebAccessWorkflowSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('auto-summary'),
  Type.Literal('summary-review')
]);

const GithubCloneUpdateSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    maxRepoSizeMB: Type.Optional(Type.Number()),
    cloneTimeoutSeconds: Type.Optional(Type.Number()),
    clonePath: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

const YoutubeUpdateSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    preferredModel: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

const VideoUpdateSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    preferredModel: Type.Optional(Type.String()),
    maxSizeMB: Type.Optional(Type.Number())
  },
  { additionalProperties: false }
);

const SsrfUpdateSchema = Type.Object(
  { allowRanges: Type.Optional(Type.Array(Type.String())) },
  { additionalProperties: false }
);

export const UpdatePiWebAccessSettingsPayloadSchema = Type.Object(
  {
    webSearchEnabled: Type.Optional(Type.Boolean()),
    provider: Type.Optional(PiWebAccessProviderSchema),
    workflow: Type.Optional(PiWebAccessWorkflowSchema),
    openaiApiKey: Type.Optional(Type.String()),
    braveApiKey: Type.Optional(Type.String()),
    exaApiKey: Type.Optional(Type.String()),
    parallelApiKey: Type.Optional(Type.String()),
    tavilyApiKey: Type.Optional(Type.String()),
    perplexityApiKey: Type.Optional(Type.String()),
    geminiApiKey: Type.Optional(Type.String()),
    geminiBaseUrl: Type.Optional(Type.String()),
    cloudflareApiKey: Type.Optional(Type.String()),
    allowBrowserCookies: Type.Optional(Type.Boolean()),
    chromeProfile: Type.Optional(Type.String()),
    searchModel: Type.Optional(Type.String()),
    summaryModel: Type.Optional(Type.String()),
    curatorTimeoutSeconds: Type.Optional(Type.Number()),
    githubClone: Type.Optional(GithubCloneUpdateSchema),
    youtube: Type.Optional(YoutubeUpdateSchema),
    video: Type.Optional(VideoUpdateSchema),
    ssrf: Type.Optional(SsrfUpdateSchema)
  },
  { additionalProperties: false }
);

export const UpdatePiWebAccessSettingsArgsSchema = Type.Tuple([UpdatePiWebAccessSettingsPayloadSchema]);
export const UpdatePiWebAccessSettingsArgsValidator = Compile(UpdatePiWebAccessSettingsArgsSchema);
