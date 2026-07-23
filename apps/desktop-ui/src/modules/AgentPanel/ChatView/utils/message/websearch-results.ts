import { lexer } from 'marked';
import { sift, unique } from 'radash';

import { cleanUrlToken, collapseWhitespace, getHostname } from '@chaptale/shared';

export { getHostname };

export type SearchCitation = {
  title: string;
  link: string;
  description?: string;
};

export type ParsedSearchResult = {
  queries: string[];
  summary: string;
  citations: SearchCitation[];
  statusNotes: string[];
};

/**
 * 将 Web Search 工具的多代输出归一化为摘要、查询词和引用。
 * 旧版 JSON 数组优先解析；新版 Markdown 则同时结合 lexer token 与宽松逐行扫描，兼容不同 provider 的格式差异。
 */
export function parseSearchResult(content: string): ParsedSearchResult {
  const legacyResults = parseLegacyJsonResults(content);

  if (legacyResults.length > 0) {
    return {
      queries: [],
      summary: '',
      citations: dedupeCitations(legacyResults),
      statusNotes: []
    };
  }

  return {
    queries: parseQueries(content),
    summary: extractSearchSummary(content),
    citations: dedupeCitations(parseMarkdownSources(content)),
    statusNotes: extractStatusNotes(content)
  };
}

function parseLegacyJsonResults(content: string): SearchCitation[] {
  try {
    const parsed = JSON.parse(content) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    const results: SearchCitation[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const record = item as Record<string, unknown>;
      const title = typeof record.title === 'string' ? record.title : '';
      const link = typeof record.link === 'string' ? record.link : typeof record.url === 'string' ? record.url : '';
      const description =
        typeof record.description === 'string'
          ? record.description
          : typeof record.snippet === 'string'
            ? record.snippet
            : undefined;

      if (title && link) {
        results.push({ title, link, description });
      }
    }

    return results;
  } catch {
    return [];
  }
}

function parseQueries(content: string) {
  const queries = getMarkdownTokens(content)
    .filter(token => token.type === 'heading')
    .map(token => ('text' in token && typeof token.text === 'string' ? token.text : ''))
    .map(text => text.match(/^(?:Query|Results for):\s+"(.+)"/i)?.[1])
    .filter((query): query is string => Boolean(query));

  return unique(queries);
}

// token 解析覆盖标准列表，逐行扫描补充编号标题、三级标题及下一行 URL 等非标准输出。
function parseMarkdownSources(content: string): SearchCitation[] {
  const lines = content.split('\n');
  const results: SearchCitation[] = parseListSourceTokens(content);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    const markdownLink = line.match(/(?:^|\s)(?:\d+[.)]\s*)?\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/);

    if (markdownLink) {
      results.push({ title: cleanTitle(markdownLink[1]), link: cleanUrlToken(markdownLink[2]) });
      continue;
    }

    const numberedTitle = line.match(/^\d+[.)]\s+(.+)$/);

    if (numberedTitle) {
      const nextUrl = findNextUrl(lines, index + 1);

      if (nextUrl) {
        results.push({ title: cleanTitle(numberedTitle[1]), link: nextUrl });
      }

      continue;
    }

    const headingTitle = line.match(/^###\s+(.+)$/);

    if (headingTitle) {
      const nextUrl = findNextUrl(lines, index + 1);

      if (nextUrl) {
        results.push({ title: cleanTitle(headingTitle[1]), link: nextUrl });
      }
    }
  }

  return results;
}

function parseListSourceTokens(content: string): SearchCitation[] {
  const results: SearchCitation[] = [];

  for (const token of getMarkdownTokens(content)) {
    if (token.type !== 'list' || !('items' in token) || !Array.isArray(token.items)) {
      continue;
    }

    for (const item of token.items) {
      const text = typeof item.text === 'string' ? item.text : '';
      const citation = parseSourceText(text);

      if (citation) {
        results.push(citation);
      }
    }
  }

  return results;
}

function parseSourceText(text: string): SearchCitation | undefined {
  const lines = sift(text.split('\n').map(line => line.trim()));
  const urlIndex = lines.findIndex(line => /^https?:\/\//.test(line));

  if (urlIndex === -1) {
    return undefined;
  }

  const title = lines.slice(0, urlIndex).join(' ') || lines[urlIndex];
  return { title: cleanTitle(title), link: cleanUrlToken(lines[urlIndex]) };
}

function getMarkdownTokens(content: string) {
  return lexer(content, { gfm: true, breaks: true });
}

function findNextUrl(lines: string[], startIndex: number) {
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 3); index += 1) {
    const line = lines[index]?.trim() ?? '';
    const match = line.match(/https?:\/\/\S+/);

    if (match) {
      return cleanUrlToken(match[0]);
    }

    if (line && (/^\d+[.)]\s+/.test(line) || /^#{2,3}\s+/.test(line))) {
      return undefined;
    }
  }

  return undefined;
}

/** 引用按清理后的链接去重，保留首次出现的标题和描述顺序。 */
function dedupeCitations(items: SearchCitation[]) {
  return unique(
    items.filter(item => item.link.trim()),
    item => item.link.trim()
  );
}

function extractSearchSummary(content: string) {
  const summaryLines: string[] = [];
  let skippingSources = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      if (summaryLines.length > 0) {
        summaryLines.push(' ');
      }
      continue;
    }

    if (/^---+$/.test(line)) {
      skippingSources = false;
      continue;
    }

    if (/^\*\*?Sources:?\*\*?$/i.test(line)) {
      skippingSources = true;
      continue;
    }

    if (isMetaLine(line) || skippingSources || /^\d+[.)]\s+/.test(line) || /^https?:\/\//.test(line)) {
      continue;
    }

    summaryLines.push(cleanSummaryLine(line));
  }

  return collapseWhitespace(summaryLines.join(' ')).slice(0, 260);
}

function extractStatusNotes(content: string) {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line =>
      /^Content fetching in background \[[^\]]+]|^Full content for \d+ sources available \[[^\]]+]/i.test(line)
    )
    .map(line => line.replace(/\.$/, ''));
}

function isMetaLine(line: string) {
  return (
    /^#{2,3}\s+/.test(line) ||
    /^Error:/i.test(line) ||
    /^No results found\.?$/i.test(line) ||
    /^\[These results were manually curated/i.test(line) ||
    /^Content fetching in background/i.test(line) ||
    /^Full content for \d+ sources available/i.test(line)
  );
}

function cleanTitle(title: string) {
  return collapseWhitespace(title.replace(/^#+\s*/, '').replace(/\s+[-–—]\s*$/, ''));
}

function cleanSummaryLine(line: string) {
  return line
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/^[-*]\s+/, '')
    .replace(/^#+\s*/, '');
}
