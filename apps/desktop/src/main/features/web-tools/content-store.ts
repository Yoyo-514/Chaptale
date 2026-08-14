import MiniSearch from 'minisearch';

export type StoredContent = {
  url: string;
  title: string;
  text: string;
  wordCount: number;
  fetchedAt: number;
};

export type ContentMatch = {
  url: string;
  title: string;
  excerpt: string;
  score: number;
};

export type ContentStoreOptions = {
  /** 缓存条目上限；超出时淘汰最旧条目。 */
  maxEntries?: number;
  /** 检索分词器；缺省用 Intl 轻量分词。装配时可注入会话级 jieba 分词器。 */
  tokenize?: (text: string) => string[];
};

const DEFAULT_MAX_ENTRIES = 40;
const EXCERPT_CONTEXT = 60;

type SearchDocument = {
  id: string;
  title: string;
  text: string;
};

/**
 * 会话级已抓取内容缓存：fetch_content 成功后写入，get_search_content 在此检索。
 *
 * 检索复用项目既有的 MiniSearch（BM25 评分）；生命周期与聊天会话一致（由装配方
 * 创建/销毁），不落盘。分词器可注入：默认 Intl 轻量分词，装配时可接 jieba。
 */
export class ContentStore {
  private readonly entries = new Map<string, StoredContent>();
  private readonly maxEntries: number;
  private readonly index: MiniSearch<SearchDocument>;

  constructor(options: ContentStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const tokenize = options.tokenize ?? defaultTokenize;

    this.index = new MiniSearch<SearchDocument>({
      fields: ['title', 'text'],
      tokenize
    });
  }

  put(content: StoredContent): void {
    if (this.entries.has(content.url)) {
      this.index.discard(content.url);
      this.entries.delete(content.url);
    }

    this.entries.set(content.url, content);
    this.index.add({ id: content.url, title: content.title, text: content.text });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.index.discard(oldest);
      this.entries.delete(oldest);
    }
  }

  get(url: string): StoredContent | undefined {
    return this.entries.get(url);
  }

  all(): StoredContent[] {
    return [...this.entries.values()];
  }

  clear(): void {
    this.entries.clear();
    this.index.removeAll();
  }

  /** 全库关键词检索：MiniSearch 评分排序，返回带上下文摘录的匹配列表。 */
  search(query: string, limit = 5): ContentMatch[] {
    if (!query.trim()) {
      return [];
    }

    const results = this.index.search(query, { prefix: true }).slice(0, limit);

    return results.flatMap(result => {
      const content = this.entries.get(result.id);

      return content
        ? [
            {
              url: content.url,
              title: content.title,
              excerpt: buildExcerpt(content.text, firstTerm(query)),
              score: result.score
            }
          ]
        : [];
    });
  }

  /** 定位单个页面内的段落：命中返回带上下文摘录，未命中返回空。 */
  findInPage(url: string, term: string): ContentMatch[] {
    const content = this.entries.get(url);

    if (!content || !term.trim()) {
      return [];
    }

    const index = content.text.indexOf(term);

    if (index === -1) {
      return [];
    }

    return [
      {
        url: content.url,
        title: content.title,
        excerpt: buildExcerpt(content.text, term),
        score: 1
      }
    ];
  }
}

/** 轻量分词：中英混排按 Intl 词级切分并小写化；无原生依赖，测试与默认装配共用。 */
function defaultTokenize(text: string): string[] {
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

  return [...segmenter.segment(text)]
    .map(segment => segment.segment.trim().toLowerCase())
    .filter(segment => segment.length > 0);
}

function firstTerm(query: string): string {
  return defaultTokenize(query)[0] ?? query.trim();
}

function buildExcerpt(text: string, term: string, context = EXCERPT_CONTEXT): string {
  const index = text.toLowerCase().indexOf(term.toLowerCase());

  if (index === -1) {
    return text.slice(0, context * 2).trim();
  }

  const start = Math.max(0, index - context);
  const end = Math.min(text.length, index + term.length + context);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';

  return (prefix + text.slice(start, end).replace(/\s+/g, ' ') + suffix).trim();
}
