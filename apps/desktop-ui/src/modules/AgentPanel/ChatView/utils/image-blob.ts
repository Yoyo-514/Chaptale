import type { ChatImageSource } from '@chaptale/shared';

import { getDesktopApi } from '@/stores/utils/desktop-api';

/**
 * 读取会话/上下文图片并转成 Blob。
 * 入参可能是 Vue 响应式 Proxy，必须先展开成纯对象再过 IPC，否则结构化克隆会抛
 * "An object could not be cloned"。
 */
export async function readImageBlob(source: ChatImageSource): Promise<Blob> {
  const payload: ChatImageSource =
    source.type === 'session-entry'
      ? {
          type: 'session-entry',
          sessionId: source.sessionId,
          entryId: source.entryId,
          blockIndex: source.blockIndex
        }
      : { type: 'context-file', path: source.path };
  const result = await getDesktopApi().session.readImage(payload);
  return new Blob([new Uint8Array(result.data)], { type: result.mimeType });
}
