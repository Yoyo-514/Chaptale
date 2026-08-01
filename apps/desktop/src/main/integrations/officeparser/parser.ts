import path from 'node:path';
import { parseOffice, type OfficeParserAST, type OfficeParserConfig } from 'officeparser';

import type { DocumentParserPort, ParsedDocument } from '../../core/context/document-parser-port';

const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.rtf', '.odt', '.odp', '.ods']);
const PARSE_TIMEOUT_MS = 30_000;

const PARSE_CONFIG = {
  extractAttachments: false,
  includeRawContent: false,
  ocr: false,
  ignoreSlideMasters: true,
  decompressionLimits: {
    maxUncompressedBytes: 128 * 1024 * 1024,
    maxZipEntries: 5_000,
    maxTableCells: 100_000
  }
} as const satisfies OfficeParserConfig;

type ParseOffice = typeof parseOffice;

export type OfficeDocumentParserOptions = {
  parseOffice?: ParseOffice;
  timeoutMs?: number;
};

/** officeparser 防腐层；只提取原生文本，永久关闭 OCR 与二进制附件。 */
export class OfficeDocumentParser implements DocumentParserPort {
  private readonly parseFile: ParseOffice;
  private readonly timeoutMs: number;

  constructor(options: OfficeDocumentParserOptions = {}) {
    this.parseFile = options.parseOffice ?? parseOffice;
    this.timeoutMs = options.timeoutMs ?? PARSE_TIMEOUT_MS;
  }

  supports(filePath: string): boolean {
    return SUPPORTED_EXTS.has(path.extname(filePath).toLowerCase());
  }

  async parse(filePath: string, signal?: AbortSignal): Promise<ParsedDocument> {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const ast = await this.parseFile(filePath, { ...PARSE_CONFIG, abortSignal: abort });
    abort.throwIfAborted();

    const text = await renderText(ast);
    abort.throwIfAborted();

    return {
      text,
      warnings: ast.warnings.map(warning => ({ code: String(warning.code), message: warning.message }))
    };
  }
}

async function renderText(ast: OfficeParserAST): Promise<string> {
  const result = await ast.to('text', { includeImages: false });

  if (typeof result.value !== 'string') {
    throw new TypeError('officeparser 返回了非文本结果');
  }

  return result.value;
}
