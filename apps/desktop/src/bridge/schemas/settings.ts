import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 界面主题；取值与样式表里的主题类一一对应。 */
export const ChaptaleThemeSchema = Type.Union([Type.Literal('light'), Type.Literal('warm'), Type.Literal('dark')]);

/** 设置更新采用部分 payload；schema 只约束形状，默认值与嵌套合并由主进程设置服务负责。 */
export const UpdateChaptaleSettingsPayloadSchema = Type.Object(
  {
    editor: Type.Optional(Type.Object({ autoSave: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
    theme: Type.Optional(ChaptaleThemeSchema),
    checkUpdatesOnStartup: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

export const UpdateChaptaleSettingsArgsSchema = Type.Tuple([UpdateChaptaleSettingsPayloadSchema]);
export const UpdateChaptaleSettingsArgsValidator = Compile(UpdateChaptaleSettingsArgsSchema);
