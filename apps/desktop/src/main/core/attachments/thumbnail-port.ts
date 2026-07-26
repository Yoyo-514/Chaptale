export type ThumbnailResult = {
  dataUrl: string;
  width: number;
  height: number;
};

/** 缩略图生成失败时抛错，调用方跳过该图并记录日志。 */
export type ThumbnailFactory = (data: Buffer, mimeType: string) => ThumbnailResult;
