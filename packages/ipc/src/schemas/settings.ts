import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 设置更新采用部分 payload；schema 只约束形状，默认值与嵌套合并由主进程设置服务负责。 */

/**
 * 自动备份间隔的边界与默认值（分钟）。
 *
 * 下限不是审美选择：一次自动备份就是一次**整包上传**，间隔太短会变成高频全量——那正是要避免的。
 * 上限给到 30 天，够表达“很少备”。
 */
export const AUTO_BACKUP_INTERVAL_MINUTES = { min: 30, max: 43_200, default: 1_440 } as const;

/** 界面主题；取值与样式表里的主题类一一对应。 */
export const ChaptaleThemeSchema = Type.Union([Type.Literal('light'), Type.Literal('warm'), Type.Literal('dark')]);

/** 作品目录更新；path 传 null 表示关闭当前作品。 */
const ChaptaleWorkspaceSettingsUpdateSchema = Type.Object(
  { path: Type.Optional(Type.Union([Type.String(), Type.Null()])) },
  { additionalProperties: false }
);

/** 资源管理器偏好；跨会话保留，不随作品切换重置。 */
const ChaptaleExplorerSettingsUpdateSchema = Type.Object(
  { showInternalFiles: Type.Optional(Type.Boolean()) },
  { additionalProperties: false }
);

/**
 * 云端备份的自动节奏；只提交变化的字段，缺省由主进程设置服务补齐。
 *
 * 间隔是**分钟级**的：自动备份的节奏就是“距上次成功备份够了多少分钟”，
 * 不再另设“每日一次”这层封顶——那个封顶本来就是为了防高频全量，而间隔已经把住同一件事。
 */
const ChaptaleBackupSettingsUpdateSchema = Type.Object(
  {
    auto: Type.Optional(Type.Boolean()),
    intervalMinutes: Type.Optional(
      Type.Integer({ minimum: AUTO_BACKUP_INTERVAL_MINUTES.min, maximum: AUTO_BACKUP_INTERVAL_MINUTES.max })
    )
  },
  { additionalProperties: false }
);

export const UpdateChaptaleSettingsPayloadSchema = Type.Object(
  {
    workspace: Type.Optional(ChaptaleWorkspaceSettingsUpdateSchema),
    explorer: Type.Optional(ChaptaleExplorerSettingsUpdateSchema),
    editor: Type.Optional(Type.Object({ autoSave: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
    backup: Type.Optional(ChaptaleBackupSettingsUpdateSchema),
    theme: Type.Optional(ChaptaleThemeSchema),
    recentWorkspaces: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8 }))
  },
  { additionalProperties: false }
);

export const UpdateChaptaleSettingsArgsSchema = Type.Tuple([UpdateChaptaleSettingsPayloadSchema]);
export const UpdateChaptaleSettingsArgsValidator = Compile(UpdateChaptaleSettingsArgsSchema);
