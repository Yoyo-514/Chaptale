export const BYTES_PER_KIB = 1024;
export const BYTES_PER_MIB = BYTES_PER_KIB * 1024;

/** 参考 ChatGPT/OpenAI 文件上传硬上限：单文件 512 MB。 */
export const MAX_CONTEXT_FILE_BYTES = 512 * BYTES_PER_MIB;
/** 参考 ChatGPT 文本/文档上限：每文件约 2M tokens；当前未接入 tokenizer，仅作为 File Search TODO 的目标限制。 */
export const MAX_TEXT_DOCUMENT_TOKENS = 2_000_000;
/** 参考 OpenAI Responses File inputs：单次请求所有文件合计 50 MB，单文件也需低于该量级。 */
export const MAX_DIRECT_FILE_INPUT_BYTES = 50 * BYTES_PER_MIB;
export const MAX_DIRECT_FILE_INPUT_TOTAL_BYTES = 50 * BYTES_PER_MIB;
/** 超过此体积的图片不生成内联预览，避免 IPC 携带大 payload。 */
export const MAX_PREVIEW_IMAGE_BYTES = 5 * BYTES_PER_MIB;
/** 参考 ChatGPT 图片上传限制：单张图片 20 MB。 */
export const MAX_PROMPT_IMAGE_BYTES = 20 * BYTES_PER_MIB;

/** OpenAI File inputs 支持的常见文本/代码类文件；当前可直接按 UTF-8 文本注入。 */
export const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.text',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.ndjson',
  '.json5',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.tsv',
  '.log',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.sql',
  '.graphql',
  '.srt',
  '.vtt',
  '.eml',
  '.ics',
  '.vcf',
  '.conf',
  '.ini',
  '.properties',
  '.diff',
  '.patch',
  '.rst',
  '.tex',
  '.dockerfile',
  '.makefile',
  '.cmake',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.vue',
  '.astro',
  '.py',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.pl',
  '.r',
  '.lua',
  '.swift',
  '.scala',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.hs',
  '.clj',
  '.groovy',
  '.jl',
  '.awk'
]);

/** 常见文档/演示/表格文件；当前先作为上传文件元数据接入，后续接解析器或 provider 原生 file block。 */
export const DOCUMENT_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation'
};

export const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};
