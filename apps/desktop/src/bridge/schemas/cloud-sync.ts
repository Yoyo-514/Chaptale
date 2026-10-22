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
