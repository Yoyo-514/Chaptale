/**
 * OneDrive（Microsoft Graph）的应用凭据与端点。
 *
 * ## 为什么这里没有硬编码的 client id
 *
 * Dropbox 的 App key 是公开值、写死在代码里没问题；Entra 的 client id 也一样公开，
 * 但**必须由作者先注册一个应用**——没有它就只能显示“未配置”，不能给一个点了必然失败的登录入口。
 * 注册步骤只在这份注释里，要点三条：
 *
 * 1. 支持账户类型选“任何组织目录中的账户和个人 Microsoft 账户”（`/common` 才能同时受理两者）；
 * 2. 平台加“移动和桌面应用程序”，重定向 URI 填 `http://localhost`——**不要带端口、不要写成 127.0.0.1**：
 *    回环地址的端口按 RFC 8252 §7.3 在匹配时被忽略，所以应用每次用随机端口起回环服务器，
 *    作者不需要为端口改配置；而 `127.0.0.1` 这种 http 形状门户不接受（只能改应用清单），
 *    所以宣告的主机必须是 `localhost`。平台类型也必须选“移动和桌面应用程序”：
 *    那才会把条目记成回环客户端，端口才真的被忽略（“Web”平台是按字面匹配的）。
 * 3. API 权限加委托的 `Files.ReadWrite.AppFolder` 与 `User.Read`（前者会标为预览版）。
 *
 * 把 client id 填进下面的常量即完成接入。为空就是“本构建未内置凭据”，界面照实说。
 */
export const ONEDRIVE_CLIENT_ID = '93459e44-21e1-4a33-a532-939b0ba3a12c';

/** 个人账户与工作账户共用 `/common`：作者用哪种账号都能登录。 */
const ONEDRIVE_AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';

/**
 * 重定向端口用 0（由系统分配）。
 *
 * 这与 Dropbox 那边必须固定端口的处境相反：Entra 对 `http://localhost` 的重定向忽略端口，
 * 所以这里用随机端口既合法又更省事——端口被占用不再是一种失败。
 */
export const ONEDRIVE_REDIRECT_PORT = 0;

/**
 * 权限只到应用自己的文件夹。
 *
 * `Files.ReadWrite.AppFolder` 把可见范围限制在应用自己的文件夹里，碰不到作者云盘的其他文件；
 * `User.Read` 只用来把账户显示名读出来给界面看。
 */
export const ONEDRIVE_SCOPES = ['offline_access', 'Files.ReadWrite.AppFolder', 'User.Read'];

/**
 * 单次上传上限。
 *
 * Graph 的简单上传（`PUT .../content`）官方上限是 250 MB，超过要开 upload session 分片；
 * 分片上传不在本轮范围内：**超限就如实拦住并说明**，不做 upload session。
 */
export const ONEDRIVE_SIMPLE_UPLOAD_LIMIT = 250 * 1024 * 1024;

export const ONEDRIVE_ENDPOINTS = {
  authorize: `${ONEDRIVE_AUTHORITY}/authorize`,
  token: `${ONEDRIVE_AUTHORITY}/token`,
  /** 应用自己的文件夹：服务商按登录的账号给它建，第一次写入时创建。 */
  appRoot: 'https://graph.microsoft.com/v1.0/me/drive/special/approot',
  me: 'https://graph.microsoft.com/v1.0/me',
  drive: 'https://graph.microsoft.com/v1.0/me/drive',
  items: 'https://graph.microsoft.com/v1.0/me/drive/items'
} as const;
