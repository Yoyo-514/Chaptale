/** 单张聊天图片的跨层体积上限；主进程解码、附件读取和上下文提交共用该约束。 */
export const MAX_CHAT_IMAGE_BYTES = 20 * 1024 * 1024;

export type ChatImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type ChatImageSource =
  | {
      type: 'session-entry';
      sessionId: string;
      entryId: string;
      blockIndex: number;
    }
  | {
      type: 'context-file';
      path: string;
    };

/**
 * Renderer 使用的图片展示描述，只携带缩略图和原图定位信息。
 * 原始字节按需通过 IPC 读取，避免长期存放在消息状态中。
 */
export type ChatImageAttachment = {
  type: 'imageAttachment';
  id: string;
  mimeType: string;
  originalBytes: number;
  width: number;
  height: number;
  thumbnailDataUrl: string;
  source?: ChatImageSource;
};
