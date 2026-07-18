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
