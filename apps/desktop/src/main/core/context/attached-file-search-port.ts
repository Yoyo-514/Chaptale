export type AttachedFileSearchSnippet = {
  headingPath: string[];
  body: string;
  startOffset: number;
  endOffset: number;
};

export type AttachedFileSearchInput = {
  sourcePath: string;
  text: string;
  query: string;
  maxTokens: number;
  signal?: AbortSignal;
};

/** 为超出直接输入预算的单个附件选取相关文本片段。 */
export type AttachedFileSearchPort = {
  search(input: AttachedFileSearchInput): Promise<AttachedFileSearchSnippet[]>;
};
