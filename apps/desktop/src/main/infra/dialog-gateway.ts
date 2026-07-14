import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';

export function showOpenDialog(owner: BrowserWindow | null | undefined, options: OpenDialogOptions) {
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
}

/** 选择单个目录；用户取消时返回 undefined。 */
export async function pickDirectory(owner: BrowserWindow | null | undefined, title: string) {
  const result = await showOpenDialog(owner, { title, properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? undefined : result.filePaths[0];
}

/** 选择保存路径；用户取消时返回 undefined。 */
export async function pickSavePath(options: SaveDialogOptions) {
  const result = await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? undefined : result.filePath;
}
