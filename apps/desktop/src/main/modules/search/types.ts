export type IndexDomain = 'canon' | 'notes' | 'summaries';

export type IndexSourceRole = 'outline' | 'world' | 'characters' | 'threads' | 'notes' | 'summaries';

export type IndexSourceRoot = {
  domain: IndexDomain;
  role: IndexSourceRole;
  absolutePath: string;
};

export type IndexDiagnostic = {
  code: string;
  message: string;
  sourcePath?: string;
  role?: IndexSourceRole;
};

/** discovery 阶段的内部文件引用；absolutePath 不进入 chunk、cache 或查询结果。 */
export type IndexSourceFile = {
  sourcePath: string;
  absolutePath: string;
  domain: IndexDomain;
  role: IndexSourceRole;
  size: number;
  mtimeMs: number;
};

export type IndexSourceDocument = {
  sourcePath: string;
  domain: IndexDomain;
  role: IndexSourceRole;
  title: string;
  kind?: string;
  status?: string;
  aliases: string[];
  searchAliases: string[];
  links: string[];
  body: string;
  size: number;
  mtimeMs: number;
};

export type IndexChunk = {
  /** 内容与位置共同生成的确定性 ID；重建相同源文件时保持稳定。 */
  id: string;
  sourcePath: string;
  domain: IndexDomain;
  role: IndexSourceRole;
  title: string;
  kind?: string;
  headingPath: string[];
  ordinal: number;
  /** offset 相对于去除 frontmatter 后的 body，区间采用 [startOffset, endOffset)。 */
  startOffset: number;
  endOffset: number;
  previousId?: string;
  nextId?: string;
  body: string;
  pinyin: string;
};

export type IndexSearchOptions = {
  domains?: IndexDomain[];
  limit?: number;
};

export type IndexSearchResult = {
  chunkId: string;
  sourcePath: string;
  domain: IndexDomain;
  title: string;
  kind?: string;
  headingPath: string[];
  body: string;
  matchedTerms: string[];
  score: number;
  previousId?: string;
  nextId?: string;
};

export interface IndexSourceResolver {
  resolve(cwd: string): Promise<{ roots: IndexSourceRoot[]; diagnostics: IndexDiagnostic[] }>;
}
