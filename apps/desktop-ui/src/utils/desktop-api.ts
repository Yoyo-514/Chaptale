import { errorToMessage } from '@chaptale/shared';

/**
 * 渲染层访问桌面 IPC 的唯一入口。
 * 约定：组件/composable 不直接读 window.chaptaleDesktop，一律经由本模块（或封装它的 store）。
 */
export function getDesktopApi() {
  if (!window.chaptaleDesktop) {
    throw new Error('当前界面需要在 Chaptale 桌面端中运行');
  }

  return window.chaptaleDesktop;
}

/** 是否运行在桌面端（浏览器 e2e/dev 环境下为 false）。 */
export function hasDesktopApi() {
  return typeof window !== 'undefined' && Boolean(window.chaptaleDesktop);
}

export function toErrorMessage(error: unknown) {
  // Electron IPC 错误带有 "Error invoking remote method 'xxx':" 前缀，去掉后更可读
  return errorToMessage(error).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}
