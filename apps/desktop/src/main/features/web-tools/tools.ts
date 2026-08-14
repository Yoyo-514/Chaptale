import { Type } from 'typebox';

import type { ToolDefinition } from '../../core/tool-protocol/definition';
import { ContentStore } from './content-store';
import { extractContent } from './fetch/extract';
import { fetchPage } from './fetch/fetch-page';
import { webSearch } from './search/search';
import type { WebToolsSettings, WebToolsSettingsStore } from './settings';

export type WebToolsDeps = {
  settingsStore: WebToolsSettingsStore;
  contentStore: ContentStore;
  /** 测试注入；缺省使用全局 fetch。 */
  fetch?: typeof globalThis.fetch;
};

/**
 * web 工具装配：读取同一份 web-tools.json，三个工具共享内容缓存。
 * 依赖 settingsStore 而非快照配置，保证设置页修改后下一次调用即生效。
 */
export function createWebTools(deps: WebToolsDeps): ToolDefinition[] {
  const depsWithFetch = { ...deps, fetch: deps.fetch ?? globalThis.fetch };

  return [
    createWebSearchTool(depsWithFetch),
    createFetchContentTool(depsWithFetch),
    createGetSearchContentTool(depsWithFetch)
  ];
}

const webSearchParameters = Type.Object(
  {
    query: Type.String({ description: '检索词' }),
    maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: '返回条数，默认 8' }))
  },
  { additionalProperties: false }
);

function createWebSearchTool(
  deps: WebToolsDeps & { fetch: typeof globalThis.fetch }
): ToolDefinition<typeof webSearchParameters> {
  return {
    name: 'web_search',
    label: '网页搜索',
    riskLevel: 'mutating',
    description: '搜索互联网。返回标题、链接与摘要列表；需要全文时再用 fetch_content 抓取对应链接。',
    parameters: webSearchParameters,
    async execute(params) {
      const settings = await deps.settingsStore.read();

      if (!settings.search.enabled) {
        return {
          text: '联网搜索已关闭；如需启用请在聊天输入框打开联网开关或在设置中开启。',
          details: { results: [], disabled: true }
        };
      }

      const results = await webSearch(
        settings.search.provider,
        { fetch: deps.fetch, keys: settings.keys },
        {
          query: params.query,
          maxResults: params.maxResults ?? 8,
          timeoutMs: settings.fetch.timeoutSeconds * 1000
        }
      );

      if (results.length === 0) {
        return { text: '没有找到相关结果；可调整检索词后重试。', details: { results: [] } };
      }

      const lines = results.map((item, index) => `${index + 1}. ${item.title} — ${item.url}\n${item.snippet}`);

      return { text: lines.join('\n\n'), details: { results } };
    }
  };
}

const fetchContentParameters = Type.Object(
  {
    url: Type.String({ description: '目标 URL（http/https）' }),
    mode: Type.Optional(
      Type.Union([Type.Literal('markdown'), Type.Literal('text'), Type.Literal('raw')], {
        description: '返回格式：markdown（默认，正文提取）/ text（纯文本）/ raw（原始内容）'
      })
    )
  },
  { additionalProperties: false }
);

function createFetchContentTool(
  deps: WebToolsDeps & { fetch: typeof globalThis.fetch }
): ToolDefinition<typeof fetchContentParameters> {
  return {
    name: 'fetch_content',
    label: '抓取网页',
    riskLevel: 'mutating',
    description:
      '抓取 URL 内容并转为 markdown。支持 HTML 正文提取、纯文本与 JSON；内网地址会被拒绝。成功后内容进入会话缓存，可用 get_search_content 检索。',
    parameters: fetchContentParameters,
    async execute(params, signal) {
      const settings = await deps.settingsStore.read();
      const page = await fetchPage(params.url, deps, {
        timeoutSeconds: settings.fetch.timeoutSeconds,
        maxBytes: settings.fetch.maxBytes,
        allowRanges: settings.ssrf.allowRanges,
        signal
      });

      const mode = params.mode ?? 'markdown';
      const extracted = extractContent(page.body, page.url, page.contentType);

      deps.contentStore.put({
        url: page.url,
        title: extracted.title,
        text: extracted.text,
        wordCount: extracted.wordCount,
        fetchedAt: Date.now()
      });

      const content = mode === 'text' ? extracted.text : mode === 'raw' ? page.body : extracted.markdown;
      const truncatedHint = page.truncated ? '\n\n（内容超过大小上限已截断）' : '';

      return {
        text: `# ${extracted.title}\n\n${content}${truncatedHint}`,
        details: {
          url: page.url,
          title: extracted.title,
          truncated: page.truncated,
          contentMarkdown: extracted.markdown,
          contentText: extracted.text,
          wordCount: extracted.wordCount
        }
      };
    }
  };
}

const getSearchContentParameters = Type.Union(
  [
    Type.Object({ query: Type.String({ description: '检索已缓存页面的关键词' }) }, { additionalProperties: false }),
    Type.Object(
      {
        url: Type.String({ description: '定位到具体缓存页面' }),
        findText: Type.Optional(Type.String({ description: '在该页面中查找的词句' }))
      },
      { additionalProperties: false }
    )
  ],
  { description: '两种用法二选一：关键词全库检索，或指定页面内查找' }
);

function createGetSearchContentTool(deps: WebToolsDeps): ToolDefinition<typeof getSearchContentParameters> {
  return {
    name: 'get_search_content',
    label: '查缓存内容',
    riskLevel: 'readonly',
    description:
      '检索本会话已抓取（fetch_content）的内容：按关键词在全库找匹配段落，或指定 url 在页面内查找。避免重复抓取。',
    parameters: getSearchContentParameters,
    async execute(params) {
      if ('query' in params) {
        const matches = deps.contentStore.search(params.query);

        if (matches.length === 0) {
          return {
            text: '会话缓存中没有匹配内容；可先用 fetch_content 抓取相关页面。',
            details: { matches: [] }
          };
        }

        const lines = matches.map(match => `${match.title} — ${match.url}\n${match.excerpt}`);

        return { text: lines.join('\n\n'), details: { matches } };
      }

      const url = normalizeUrlKey(params.url);
      const entry = deps.contentStore.get(url);

      if (!entry) {
        return {
          text: '该页面不在会话缓存中；请先用 fetch_content 抓取。',
          details: { matches: [] }
        };
      }

      if (!params.findText) {
        return {
          text: `${entry.title}（约 ${entry.wordCount} 词）已缓存：${entry.url}`,
          details: { matches: [{ url: entry.url, title: entry.title, excerpt: entry.text.slice(0, 120), score: 1 }] }
        };
      }

      const matches = deps.contentStore.findInPage(url, params.findText);

      if (matches.length === 0) {
        return {
          text: `缓存页面中没有找到「${params.findText}」。`,
          details: { matches: [] }
        };
      }

      return { text: matches[0].excerpt, details: { matches } };
    }
  };
}

/** URL 归一化为缓存键：去锚点、去尾斜杠差异。 */
function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

export type { WebToolsSettings };
