import type { SkillInvocation } from '../utils';

export type ChatSkillInvocation = SkillInvocation;

export type ChatContextFile = {
  path: string;
  name: string;
  size: number;
  kind: 'text' | 'document' | 'image' | 'unsupported';
  mimeType?: string;
  /** Main 生成的缩略图 data URL，不包含原始图片数据。 */
  previewDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  skippedReason?:
    | 'file-too-large'
    | 'image-too-large'
    | 'file-unavailable'
    | 'document-format-unsupported'
    | 'document-parse-failed'
    | 'document-no-text'
    | 'document-too-large'
    | 'document-text-too-large';
};
