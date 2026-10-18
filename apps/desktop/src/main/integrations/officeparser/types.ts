export type DocumentParseWarning = {
  code: string;
  message: string;
};

/** 无原生文本时的核心级归因；由适配器翻译第三方解析器的警告码，core 不感知具体解析器。 */
export type DocumentNoTextReason = 'scanned' | 'unreadable';

export type ParsedDocument = {
  text: string;
  warnings: DocumentParseWarning[];
  /** text 去空白后为空时的归因；提取到可用文本时不设置。 */
  noTextReason?: DocumentNoTextReason;
};

/** 二进制文档文本提取端口；实现不得把第三方解析器类型泄漏到 core。 */
export type DocumentParserPort = {
  supports(filePath: string): boolean;
  parse(filePath: string, signal?: AbortSignal): Promise<ParsedDocument>;
};
