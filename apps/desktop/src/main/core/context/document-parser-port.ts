export type DocumentParseWarning = {
  code: string;
  message: string;
};

export type ParsedDocument = {
  text: string;
  warnings: DocumentParseWarning[];
};

/** 二进制文档文本提取端口；实现不得把第三方解析器类型泄漏到 core。 */
export type DocumentParserPort = {
  supports(filePath: string): boolean;
  parse(filePath: string, signal?: AbortSignal): Promise<ParsedDocument>;
};
