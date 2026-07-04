export function getDesktopApi() {
  if (!window.chaptaleDesktop) {
    throw new Error('当前界面需要在 Chaptale 桌面端中运行');
  }

  return window.chaptaleDesktop;
}

export function toErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // Electron IPC 错误带有 "Error invoking remote method 'xxx':" 前缀，去掉后更可读
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}
