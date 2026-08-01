import path from 'node:path';

import { escapeXmlAttribute, escapeXmlText, formatFileSize } from '@chaptale/shared';

import type { AttachedFileSearchSnippet } from './attached-file-search-port';
import { MAX_CONTEXT_FILE_BYTES, MAX_DIRECT_TOKENS } from './constants';

export function buildSearchPlaceholder(filePath: string, stats: { size: number }) {
  return `<file path="${escapeXmlAttribute(filePath)}" handling="file-search-placeholder" size="${escapeXmlAttribute(formatFileSize(stats.size))}">
<summary>
该文本未作为基础 File input 全文注入，且本次本地关键词检索未能提供片段。agent 应使用 read/grep/find/ls 等文件工具按需读取原文件，不能声称已完整逐字阅读全文。
</summary>
<metadata>
文件名：${escapeXmlText(path.basename(filePath))}
文件大小：${escapeXmlText(formatFileSize(stats.size))}
参考限制：OpenAI 文件上传硬上限 ${escapeXmlText(formatFileSize(MAX_CONTEXT_FILE_BYTES))}；文本/文档目标上限约 ${MAX_DIRECT_TOKENS.toLocaleString()} tokens。
</metadata>
</file>`;
}

export function buildSearchResult(
  filePath: string,
  stats: { size: number },
  snippets: AttachedFileSearchSnippet[],
  options: { kind: 'text' | 'document'; mimeType?: string }
) {
  const mimeType = options.mimeType ? ` mimeType="${escapeXmlAttribute(options.mimeType)}"` : '';
  const excerpts = snippets
    .map((snippet, index) => {
      const heading = snippet.headingPath.length
        ? ` heading="${escapeXmlAttribute(snippet.headingPath.join(' / '))}"`
        : '';
      return `<excerpt index="${index + 1}"${heading} startOffset="${snippet.startOffset}" endOffset="${snippet.endOffset}">${escapeXmlText(snippet.body)}</excerpt>`;
    })
    .join('\n');

  return `<file path="${escapeXmlAttribute(filePath)}" handling="file-search-results" kind="${options.kind}"${mimeType} size="${escapeXmlAttribute(formatFileSize(stats.size))}">
<summary>全文超过直接上下文预算。以下内容是应用根据当前请求通过本地关键词索引选出的原文片段，不代表完整文件。</summary>
<excerpts>
${excerpts}
</excerpts>
</file>`;
}

export function buildUnavailableFileBlock(filePath: string, kind: 'text' | 'document' | 'image') {
  return `<file path="${escapeXmlAttribute(filePath)}" kind="${kind}" skipped="true" reason="file-unavailable">发送消息时无法读取该文件，未发送给模型。文件可能已被移动、删除或占用，请重新选择后重试。</file>`;
}

export function buildOversizedFileBlock(filePath: string, stats: { size: number }) {
  return `<file path="${escapeXmlAttribute(filePath)}" skipped="true" reason="file-too-large" size="${escapeXmlAttribute(formatFileSize(stats.size))}">文件超过 ${formatFileSize(MAX_CONTEXT_FILE_BYTES)} 的参考上传上限，未发送给模型。请拆分、压缩，或选择更小的文件。</file>`;
}

export function buildOversizedImageBlock(filePath: string, stats: { size: number }, maxPromptImageBytes: number) {
  return `<file path="${escapeXmlAttribute(filePath)}" kind="image" skipped="true" reason="image-too-large" size="${escapeXmlAttribute(formatFileSize(stats.size))}">图片超过 ${formatFileSize(maxPromptImageBytes)}，未发送给模型。请压缩、裁剪，或改用更小的图片后重试。</file>`;
}
