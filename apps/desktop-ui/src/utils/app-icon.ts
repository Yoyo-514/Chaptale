/**
 * 应用图标的 URL。
 *
 * 不能硬写 `/favicon.ico`：打包后 renderer 走 `file://`，绝对根路径会被解析到盘符根
 * （`file:///E:/favicon.ico`），图标必然 404。BASE_URL 在 dev 下是 `/`、build 下是 `./`，
 * 后者相对 index.html 解析，两种形态都能命中 public 里的实际文件。
 */
export const APP_ICON_URL = `${import.meta.env.BASE_URL}favicon.ico`;
