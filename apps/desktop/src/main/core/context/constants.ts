import { MAX_CHAT_IMAGE_BYTES } from '@chaptale/shared';

export const BYTES_PER_KIB = 1024;
export const BYTES_PER_MIB = BYTES_PER_KIB * 1024;

/** 参考 ChatGPT/OpenAI 文件上传硬上限：单文件 512 MB。 */
export const MAX_CONTEXT_FILE_BYTES = 512 * BYTES_PER_MIB;
/** 参考 ChatGPT 文本/文档上限：每文件约 2M tokens；ASCII 参考 pi，非 ASCII 按一字符一 token。 */
export const MAX_TEXT_DOCUMENT_TOKENS = 2_000_000;
/** 参考 OpenAI Responses File inputs：单次请求所有文件合计 50 MB，单文件也需低于该量级。 */
export const MAX_DIRECT_FILE_INPUT_BYTES = 50 * BYTES_PER_MIB;
export const MAX_DIRECT_FILE_INPUT_TOTAL_BYTES = 50 * BYTES_PER_MIB;
/** 参考 ChatGPT 图片上传限制：单张图片 20 MB。 */
export const MAX_PROMPT_IMAGE_BYTES = MAX_CHAT_IMAGE_BYTES;
