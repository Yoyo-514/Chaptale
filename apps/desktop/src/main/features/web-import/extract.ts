import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export type ExtractedContent = {
  title: string;
  markdown: string;
  text: string;
  wordCount: number;
};

/**
 * HTML 正文提取：readability 语义提取 → turndown 转 markdown。
 *
 * 提取失败（极简页面、非文章结构）时降级为标题+剥标签纯文本，保证任何 HTML 都有可用产出。
 * JSON 输入直接原样返回（本身即模型友好格式）。
 */
export function extractContent(html: string, url: string, contentType: string): ExtractedContent {
  if (contentType === 'application/json') {
    return { title: url, markdown: html.trim(), text: html.trim(), wordCount: countWords(html) };
  }

  const document = parseHTML(html).document;

  // 纯文本输入解析不出 documentElement，而 linkedom 的 title / head / body 都是会就地
  // 解构它的 getter——`?.` 防得住 null 值，防不住抛错的 getter，抓一个 .txt 就以
  // TypeError 收场。整棵树都不存在时没什么可提取的，原文即正文。
  if (!document.documentElement) {
    const text = html.trim();

    return { title: url, markdown: text, text, wordCount: countWords(text) };
  }

  try {
    const article = new Readability(document as unknown as Document).parse();

    if (article?.content) {
      const markdown = htmlToMarkdown(article.content);

      return {
        title: article.title?.trim() || fallbackTitle(document) || url,
        markdown,
        text: stripTags(markdown),
        wordCount: countWords(article.textContent ?? markdown)
      };
    }
  } catch {
    // readability 抛错（畸形 DOM 等）走降级路径。
  }

  // 降级路径重新解析一份：Readability 解析时会破坏传入的 document（剥离节点），
  // 失败后原 document 已不可用；片段文档的 body 可能存在但为空，退取 documentElement。
  const fresh = parseHTML(html).document;
  const title = fallbackTitle(fresh) || url;
  const bodyText = fresh.body?.textContent?.replace(/\s+\n/g, '\n').trim();
  const text = bodyText || fresh.documentElement?.textContent?.replace(/\s+\n/g, '\n').trim() || html.trim();

  return { title, markdown: text, text, wordCount: countWords(text) };
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
});

// 保留原生表格转换；去掉 readbility 输出中常见的冗余 class。
turndown.keep(['sub', 'sup']);

function htmlToMarkdown(html: string): string {
  try {
    const { document } = parseHTML(`<div id="root">${html}</div>`);
    const markdown = turndown.turndown(document.getElementById('root') as unknown as HTMLElement);

    return markdown.trim();
  } catch {
    return stripTags(html);
  }
}

function fallbackTitle(document: Document): string {
  return document.title?.trim() ?? document.querySelector('h1')?.textContent?.trim() ?? '';
}

/** markdown 语法字符剥除后计数；CJK 按字符计，其余按空白分词计。 */
function countWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g)?.length ?? 0;
  const words = text
    .replace(/[\u4e00-\u9fff\u3040-\u30ff]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + words;
}

function stripTags(markdownOrHtml: string): string {
  return markdownOrHtml
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}
