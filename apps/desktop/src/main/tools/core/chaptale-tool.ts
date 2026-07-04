import type { TSchema } from 'typebox';

export type ChaptaleToolTextContent = {
  type: 'text';
  text: string;
};

export type ChaptaleToolResult = {
  content: ChaptaleToolTextContent[];
  details?: unknown;
};

/**
 * Chaptale 自有工具定义。
 *
 * 这里刻意不直接暴露 pi SDK 类型，方便后续把专有工具复用到其他 runtime。
 */
export type ChaptaleToolDefinition<TParameters extends TSchema = TSchema> = {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  execute(params: unknown, signal?: AbortSignal): Promise<ChaptaleToolResult>;
};
