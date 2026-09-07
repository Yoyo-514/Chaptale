import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 设置更新采用部分 payload；schema 只约束形状，默认值与嵌套合并由主进程设置服务负责。 */
export const ChaptaleStorageModeSchema = Type.Union([Type.Literal('global'), Type.Literal('workspace')]);

/** 界面主题；取值与样式表里的主题类一一对应。 */
export const ChaptaleThemeSchema = Type.Union([Type.Literal('light'), Type.Literal('warm'), Type.Literal('dark')]);

const ChaptaleStorageSettingsUpdateSchema = Type.Object(
  {
    mode: Type.Optional(ChaptaleStorageModeSchema),
    workspacePath: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

/** 资源管理器偏好；跨会话保留，不随工作区切换重置。 */
const ChaptaleExplorerSettingsUpdateSchema = Type.Object(
  { showInternalFiles: Type.Optional(Type.Boolean()) },
  { additionalProperties: false }
);

export const UpdateChaptaleSettingsPayloadSchema = Type.Object(
  {
    storage: Type.Optional(ChaptaleStorageSettingsUpdateSchema),
    explorer: Type.Optional(ChaptaleExplorerSettingsUpdateSchema),
    editor: Type.Optional(Type.Object({ autoSave: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
    theme: Type.Optional(ChaptaleThemeSchema),
    lastSessionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    recentWorkspaces: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8 }))
  },
  { additionalProperties: false }
);

export const UpdateChaptaleSettingsArgsSchema = Type.Tuple([UpdateChaptaleSettingsPayloadSchema]);
export const UpdateChaptaleSettingsArgsValidator = Compile(UpdateChaptaleSettingsArgsSchema);

export const WebToolsProviderSchema = Type.Union([
  Type.Literal('duckduckgo'),
  Type.Literal('brave'),
  Type.Literal('tavily'),
  Type.Literal('exa')
]);

const WebToolsSearchUpdateSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    provider: Type.Optional(WebToolsProviderSchema)
  },
  { additionalProperties: false }
);

const WebToolsKeysUpdateSchema = Type.Object(
  {
    braveApiKey: Type.Optional(Type.String()),
    tavilyApiKey: Type.Optional(Type.String()),
    exaApiKey: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

const WebToolsFetchUpdateSchema = Type.Object(
  {
    timeoutSeconds: Type.Optional(Type.Number()),
    maxBytes: Type.Optional(Type.Number())
  },
  { additionalProperties: false }
);

const WebToolsSsrfUpdateSchema = Type.Object(
  { allowRanges: Type.Optional(Type.Array(Type.String())) },
  { additionalProperties: false }
);

export const UpdateWebToolsSettingsPayloadSchema = Type.Object(
  {
    search: Type.Optional(WebToolsSearchUpdateSchema),
    keys: Type.Optional(WebToolsKeysUpdateSchema),
    fetch: Type.Optional(WebToolsFetchUpdateSchema),
    ssrf: Type.Optional(WebToolsSsrfUpdateSchema)
  },
  { additionalProperties: false }
);

export const UpdateWebToolsSettingsArgsSchema = Type.Tuple([UpdateWebToolsSettingsPayloadSchema]);
export const UpdateWebToolsSettingsArgsValidator = Compile(UpdateWebToolsSettingsArgsSchema);
