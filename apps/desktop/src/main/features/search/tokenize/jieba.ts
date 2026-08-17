import type { IndexDiagnostic } from '../types';
import { addFallbackTerms, addTerm, IntlSegmenterTermTokenizer, normalizeSearchText, type TermTokenizer } from './term';

type JiebaInstance = InstanceType<typeof import('@node-rs/jieba').Jieba>;
type JiebaModule = typeof import('@node-rs/jieba');

type LoadedJieba = {
  Jieba: JiebaModule['Jieba'];
  dict: Buffer;
};

export type SearchTokenizerLoader = {
  loadJieba: () => Promise<LoadedJieba>;
};

export type SearchTokenizerResult = {
  tokenizer: TermTokenizer;
  diagnostics: IndexDiagnostic[];
};

class JiebaTermTokenizer implements TermTokenizer {
  readonly id = 'jieba-search-v1';
  private readonly customTerms: string[];

  constructor(
    private readonly jieba: JiebaInstance,
    customTerms: readonly string[]
  ) {
    this.customTerms = normalizeCustomTerms(customTerms);
  }

  tokenize(text: string): string[] {
    const normalized = normalizeSearchText(text);
    const terms = new Set<string>();
    for (const term of this.jieba.cutForSearch(normalized, true)) addTerm(terms, term);
    for (const term of this.customTerms) {
      if (normalized.includes(term)) terms.add(term);
    }
    addFallbackTerms(terms, normalized);
    return [...terms];
  }
}

const defaultLoader: SearchTokenizerLoader = {
  async loadJieba() {
    // 动态 import 让 N-API 加载错误落入下方降级分支，而不是在 Main 模块求值期终止应用。
    const [{ Jieba }, { dict }] = await Promise.all([import('@node-rs/jieba'), import('@node-rs/jieba/dict')]);
    return { Jieba, dict: Buffer.from(dict) };
  }
};

export async function createSearchTokenizer(
  customTerms: readonly string[],
  loader: SearchTokenizerLoader = defaultLoader
): Promise<SearchTokenizerResult> {
  try {
    const { Jieba, dict } = await loader.loadJieba();
    const normalizedTerms = normalizeCustomTerms(customTerms);
    // 高词频 workspace 专名覆盖通用词典的拆分倾向；原词仍额外直入 terms，保证确定性召回。
    const additions = normalizedTerms.length
      ? Buffer.from(`\n${normalizedTerms.map(term => `${term} 1000000 nz`).join('\n')}\n`, 'utf8')
      : Buffer.alloc(0);
    const jieba = Jieba.withDict(Buffer.concat([dict, additions]));
    return { tokenizer: new JiebaTermTokenizer(jieba, normalizedTerms), diagnostics: [] };
  } catch (error) {
    return {
      tokenizer: new IntlSegmenterTermTokenizer(),
      diagnostics: [
        {
          code: 'jieba-unavailable',
          message: `Jieba 不可用，已降级为 Intl 分词：${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

function normalizeCustomTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.map(normalizeSearchText).filter(term => [...term].length >= 2))].toSorted();
}
