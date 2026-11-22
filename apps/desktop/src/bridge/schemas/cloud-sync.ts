import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 服务商取值表；接入一个才会出现在这里，未接入的不给假入口。 */
export const CloudProviderSchema = Type.Union([Type.Literal('dropbox'), Type.Literal('onedrive')]);

/**
 * 服务商侧的文件标识：Dropbox 用路径、OneDrive 用 id。
 * 只拦空值与超长，不猜服务商的字符集（Dropbox 允许 `:` 等字符出现在路径里）。
 */
const REMOTE_ID = Type.String({ minLength: 1, maxLength: 2048 });

/** 无参数频道：状态查询与取消授权都只认空参数。 */
export const CloudNoArgsValidator = Compile(Type.Tuple([]));

export const CloudProviderArgsSchema = Type.Object({ provider: CloudProviderSchema }, { additionalProperties: false });
export const CloudProviderArgsValidator = Compile(Type.Tuple([CloudProviderArgsSchema]));

export const CloudBackupWorkArgsSchema = Type.Object(
  {
    workId: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    target: Type.Union([CloudProviderSchema, Type.Literal('all')])
  },
  { additionalProperties: false }
);
export const CloudBackupWorkArgsValidator = Compile(Type.Tuple([CloudBackupWorkArgsSchema]));

export const CloudBackupFileArgsSchema = Type.Object(
  { provider: CloudProviderSchema, fileId: REMOTE_ID },
  { additionalProperties: false }
);
export const CloudBackupFileArgsValidator = Compile(Type.Tuple([CloudBackupFileArgsSchema]));

export const CloudDiscardDownloadArgsValidator = Compile(Type.Tuple([Type.String({ minLength: 1 })]));
