import { shell } from 'electron';

/** 用系统默认浏览器打开链接。授权流程需要它把作者送到服务商页面，且不经过渲染进程。 */
export function openExternalUrl(url: string): Promise<void> {
  return shell.openExternal(url);
}
