import path from 'node:path';
import {
  OfficeWarningType,
  parseOffice,
  type OfficeIssue,
  type OfficeParserAST,
  type OfficeParserConfig
} from 'officeparser';

import type { DocumentNoTextReason, DocumentParserPort, ParsedDocument } from '../../core/context/document-parser-port';

const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.rtf', '.odt', '.odp', '.ods']);
const PARSE_TIMEOUT_MS = 30_000;

const PARSE_CONFIG = {
  extractAttachments: false,
  includeRawContent: false,
  ocr: false,
  ignoreSlideMasters: true,
  // 只取文本，颜色永不参与渲染；逐页提取颜色会带来约 1.6x 的额外解析耗时。
  pdfParserConfig: { extractTextColor: false },
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
      warnings: ast.warnings.map(warning => ({ code: String(warning.code), message: warning.message })),
      noTextReason: resolveNoTextReason(text, ast.warnings)
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

/** 无文本归因的判定优先级：文本层损坏比「没有文本层」更具体，优先报告。 */
const NO_TEXT_REASONS: ReadonlyArray<readonly [OfficeWarningType, DocumentNoTextReason]> = [
  [OfficeWarningType.PDF_TEXT_ENCODING_SUSPECT, 'unreadable'],
  [OfficeWarningType.PDF_NO_TEXT_EXTRACTED, 'scanned']
];

function resolveNoTextReason(text: string, warnings: OfficeIssue[]): DocumentNoTextReason | undefined {
  if (/\S/.test(text)) return undefined;

  const codes = new Set(warnings.map(warning => warning.code));
  return NO_TEXT_REASONS.find(([code]) => codes.has(code))?.[1];
}
