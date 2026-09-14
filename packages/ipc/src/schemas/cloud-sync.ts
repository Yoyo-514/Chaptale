import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 服务商取值表；接入一个才会出现在这里，未接入的不给假入口。 */
export const CloudProviderSchema = Type.Union([Type.Literal('dropbox'), Type.Literal('onedrive')]);

/**
 * 服务商侧的目录标识：Dropbox 用 id、WebDAV 用相对路径。
 * 只拦空值与超长，不猜服务商的字符集（Dropbox 允许 `:` 等字符出现在路径里）。
 */
const REMOTE_ID = Type.String({ minLength: 1, maxLength: 2048 });

/** 无参数频道：状态查询与取消授权都只认空参数。 */
export const CloudNoArgsValidator = Compile(Type.Tuple([]));

export const CloudProviderArgsSchema = Type.Object({ provider: CloudProviderSchema }, { additionalProperties: false });
export const CloudProviderArgsValidator = Compile(Type.Tuple([CloudProviderArgsSchema]));

export const CloudListFoldersArgsSchema = Type.Object(
  {
    provider: CloudProviderSchema,
    /**
     * 省略或传 null 表示列最顶层；其余传上一次返回的目录标识继续下钻。
     * 最顶层用 null 而不是空串：空串在路径语义下是“根路径”、在 id 语义下是无意义值，
     * 两者混用会让界面分不清“回到最顶层”和“列一个叫空的目录”。
     */
    parentId: Type.Optional(Type.Union([REMOTE_ID, Type.Null()]))
  },
  { additionalProperties: false }
);
export const CloudListFoldersArgsValidator = Compile(Type.Tuple([CloudListFoldersArgsSchema]));

/** 绑定目标：`folderId` 为 null 表示作者选的是最顶层目录。 */
export const CloudBindArgsSchema = Type.Object(
  {
    provider: CloudProviderSchema,
    folderId: Type.Union([REMOTE_ID, Type.Null()]),
    folderName: Type.String({ minLength: 1, maxLength: 512 })
  },
  { additionalProperties: false }
);
export const CloudBindArgsValidator = Compile(Type.Tuple([CloudBindArgsSchema]));

/** 归档标识：备份目录里的一个远端文件。 */
export const CloudArchiveArgsSchema = Type.Object({ archiveId: REMOTE_ID }, { additionalProperties: false });
export const CloudArchiveArgsValidator = Compile(Type.Tuple([CloudArchiveArgsSchema]));

/**
 * 批量删除的参数。
 *
 * 上限 500 是给载荷一个真实的界：界面上的勾选来自一份清单，本来就不会有更多；
 * 要求不重复，是为了让“哪几份没删掉”这句话不会因为同一个 id 出现两次而自相矛盾。
 */
export const CloudArchiveListArgsSchema = Type.Object(
  { archiveIds: Type.Array(REMOTE_ID, { minItems: 1, maxItems: 500, uniqueItems: true }) },
  { additionalProperties: false }
);
export const CloudArchiveListArgsValidator = Compile(Type.Tuple([CloudArchiveListArgsSchema]));

/** 单个冲突项：归档标识 + 归档内相对路径（正斜杠）。 */
export const CloudRestoreDiffArgsSchema = Type.Object(
  { archiveId: REMOTE_ID, relativePath: Type.String({ minLength: 1, maxLength: 1024 }) },
  { additionalProperties: false }
);
export const CloudRestoreDiffArgsValidator = Compile(Type.Tuple([CloudRestoreDiffArgsSchema]));

const CloudRestoreModeSchema = Type.Union([Type.Literal('new'), Type.Literal('overwrite'), Type.Literal('merge')]);

const CloudRestoreChoiceSchema = Type.Union([Type.Literal('archive'), Type.Literal('local'), Type.Literal('both')]);

/**
 * 恢复参数。
 *
 * `choices` 可以只带一部分：没给决议的冲突项不会被写、也不会被覆盖——
 * “作者没点头就不动文件”是执行侧的不变量，不能只靠界面保证。
 * 注意：**键的形状不受 schema 约束**（JSON Schema 的字符串长度管的是值不是键），
 * 执行侧只读匹配得上真实路径的键。
 */
export const CloudRestoreArgsSchema = Type.Object(
  {
    archiveId: REMOTE_ID,
    mode: CloudRestoreModeSchema,
    choices: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 1024 }), CloudRestoreChoiceSchema))
  },
  { additionalProperties: false }
);
export const CloudRestoreArgsValidator = Compile(Type.Tuple([CloudRestoreArgsSchema]));

/**
 * 主进程 → 渲染进程的备份进度。
 *
 * 打包阶段能给“第几个文件 / 共几个”；上传阶段只有“在传”这一个事实——
 * Dropbox 的简单上传不回报字节进度，服务商侧不可知的东西不在这里编造。
 */
export const CloudBackupProgressSchema = Type.Union([
  Type.Object(
    { phase: Type.Literal('packing'), done: Type.Integer({ minimum: 0 }), total: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false }
  ),
  Type.Object({ phase: Type.Literal('uploading') }, { additionalProperties: false })
]);
export const CloudBackupProgressValidator = Compile(CloudBackupProgressSchema);
