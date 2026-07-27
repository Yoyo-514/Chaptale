import type { ThumbnailResult } from '../attachments/thumbnail-port';

export type ContextImagePreview = ThumbnailResult;

/** 上下文文件所需的平台能力；owner 只在 port 边界透传，features 不解析其具体类型。 */
export type ContextFilePlatform = {
  selectContextFilePaths(owner?: unknown): Promise<string[]>;
  createImagePreview(data: Uint8Array, mimeType: string): Promise<ContextImagePreview | undefined>;
};
