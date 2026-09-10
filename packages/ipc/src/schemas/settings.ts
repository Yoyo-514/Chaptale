import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 设置更新采用部分 payload；schema 只约束形状，默认值与嵌套合并由主进程设置服务负责。 */

/** 界面主题；取值与样式表里的主题类一一对应。 */
export const ChaptaleThemeSchema = Type.Union([Type.Literal('light'), Type.Literal('warm'), Type.Literal('dark')]);

/** 作品目录更新；path 传 null 表示关闭当前作品（此后没有作品就没有会话）。 */
const ChaptaleWorkspaceSettingsUpdateSchema = Type.Object(
  { path: Type.Optional(Type.Union([Type.String(), Type.Null()])) },
  { additionalProperties: false }
);

/** 资源管理器偏好；跨会话保留，不随作品切换重置。 */
const ChaptaleExplorerSettingsUpdateSchema = Type.Object(
  { showInternalFiles: Type.Optional(Type.Boolean()) },
  { additionalProperties: false }
);

export const UpdateChaptaleSettingsPayloadSchema = Type.Object(
  {
    workspace: Type.Optional(ChaptaleWorkspaceSettingsUpdateSchema),
    explorer: Type.Optional(ChaptaleExplorerSettingsUpdateSchema),
    editor: Type.Optional(Type.Object({ autoSave: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
    onboarding: Type.Optional(
      Type.Object({ completedVersion: Type.Integer({ minimum: 0, maximum: 1000 }) }, { additionalProperties: false })
    ),
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
