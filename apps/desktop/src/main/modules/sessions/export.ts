import type { NativeDialogPort } from '../../core/ipc-ports';
import { writeTextFile } from '../../infra/filesystem/files';
import type { SessionRepository } from './repository';

/** 弹出保存对话框并把会话 HTML 落盘；用户取消时返回 null。 */
export async function exportSessionHtmlToFile(
  sessionRepository: SessionRepository,
  sessionId: string,
  dialog: Pick<NativeDialogPort, 'pickSavePath'>
): Promise<string | null> {
  const { html, suggestedFileName } = await sessionRepository.exportHtml(sessionId);
  const filePath = await dialog.pickSavePath({
    title: '导出会话为 HTML',
    defaultPath: suggestedFileName,
    filters: [
      { name: 'HTML', extensions: ['html'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (!filePath) {
    return null;
  }

  await writeTextFile(filePath, html);
  return filePath;
}
