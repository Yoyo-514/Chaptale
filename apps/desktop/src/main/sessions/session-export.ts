import { pickSavePath } from '../infra/dialog-gateway';
import { writeTextFile } from '../infra/fs-gateway';
import type { PiSessionRepository } from '../services/session.repository';

/** 弹出保存对话框并把会话 HTML 落盘；用户取消时返回 null。 */
export async function exportSessionHtmlToFile(
  sessionRepository: PiSessionRepository,
  sessionId: string
): Promise<string | null> {
  const { html, suggestedFileName } = await sessionRepository.exportHtml(sessionId);
  const filePath = await pickSavePath({
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
