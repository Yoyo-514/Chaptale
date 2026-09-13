/**
 * Dropbox 应用凭据与端点。
 *
 * App key 是**公开值**：它出现在授权 URL 里、跟着作者的浏览器走，本来就不保密；
 * App secret 一律不用——桌面端是公开客户端，走 PKCE，secret 无处可藏也不该藏。
 *
 * 开发状态的应用默认只能绑定创建者本人账号，App Console 可开启附加用户（上限 500）；
 * 到 50 个链接用户后需在两周内申请 production，而 Dropbox 只在应用已有 50 个用户时才受理审核。
 * 这是分发阶段的事，不影响本机与少量用户使用，详见 `docs/m7-plan/00-cloud-sync.md` 的已知边界。
 */
export const DROPBOX_APP_KEY = '836g4zzleh4vxr6';

/**
 * 固定回环端口。
 *
 * Dropbox 要求重定向 URI 与 App Console 的登记值逐字符匹配，**不能用随机端口**；
 * 改这里必须同时改 App Console，否则授权会被直接拒绝。
 */
export const DROPBOX_REDIRECT_PORT = 52475;

/** App folder 接入下这三个权限只作用于应用自己的目录，碰不到作者云盘的其他文件。 */
export const DROPBOX_SCOPES = ['account_info.read', 'files.content.read', 'files.content.write'];

/**
 * 单次上传上限。
 *
 * 超过这个尺寸要走 upload_session 分片，而分片上传是明确不在本轮范围内的（决策 14：超限报错）。
 * 把上限写在适配器里：这是服务商的知识，不是备份流程的常量。
 */
export const DROPBOX_SIMPLE_UPLOAD_LIMIT = 150 * 1024 * 1024;

export const DROPBOX_ENDPOINTS = {
  authorize: 'https://www.dropbox.com/oauth2/authorize',
  token: 'https://api.dropboxapi.com/oauth2/token',
  currentAccount: 'https://api.dropboxapi.com/2/users/get_current_account',
  spaceUsage: 'https://api.dropboxapi.com/2/users/get_space_usage',
  listFolder: 'https://api.dropboxapi.com/2/files/list_folder',
  listFolderContinue: 'https://api.dropboxapi.com/2/files/list_folder/continue',
  createFolder: 'https://api.dropboxapi.com/2/files/create_folder_v2',
  upload: 'https://api.dropboxapi.com/2/files/upload',
  download: 'https://api.dropboxapi.com/2/files/download',
  remove: 'https://api.dropboxapi.com/2/files/delete_v2'
} as const;
