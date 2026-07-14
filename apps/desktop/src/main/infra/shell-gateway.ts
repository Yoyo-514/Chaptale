import { shell } from 'electron';

/** 在系统文件管理器中打开路径；shell.openPath 以返回值而非异常报告失败，这里统一转为异常。 */
export async function openPathOrThrow(target: string) {
  const errorMessage = await shell.openPath(target);

  if (errorMessage) {
    throw new Error(errorMessage);
  }
}
