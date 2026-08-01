import { MAX_CHAT_IMAGE_BYTES } from '@chaptale/shared';

export const BYTES_PER_KIB = 1024;
export const BYTES_PER_MIB = BYTES_PER_KIB * 1024;

/** 参考 ChatGPT/OpenAI 文件上传硬上限：单文件 512 MB。 */
export const MAX_CONTEXT_FILE_BYTES = 512 * BYTES_PER_MIB;
/** 直接注入上限：每文件约 2M tokens；ASCII 参考 pi，非 ASCII 按一字符一 token。 */
export const MAX_DIRECT_TOKENS = 2_000_000;
/** 直接注入按单文件和单次请求分别限制为 50 MiB。 */
export const MAX_DIRECT_BYTES = 50 * BYTES_PER_MIB;
export const MAX_DIRECT_TOTAL_BYTES = 50 * BYTES_PER_MIB;
/** 单文件本地关键词检索读取上限。 */
export const MAX_SEARCH_BYTES = 50 * BYTES_PER_MIB;
/** 二进制文档解析上限；避免在 Main 进程中打开超大 PDF/OOXML 容器。 */
export const MAX_DOCUMENT_PARSE_BYTES = 50 * BYTES_PER_MIB;
/** 单次请求由本地附件检索注入的相关片段总预算。 */
export const MAX_SEARCH_TOKENS = 8_000;
/** 参考 ChatGPT 图片上传限制：单张图片 20 MB。 */
export const MAX_PROMPT_IMAGE_BYTES = MAX_CHAT_IMAGE_BYTES;
