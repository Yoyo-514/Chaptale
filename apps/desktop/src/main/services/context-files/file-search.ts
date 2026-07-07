import { escapeXmlAttribute, escapeXmlText, formatFileSize } from '@chaptale/shared';

import path from 'node:path';

import { MAX_CONTEXT_FILE_BYTES, MAX_DIRECT_FILE_INPUT_TOTAL_BYTES, MAX_TEXT_DOCUMENT_TOKENS } from './constants';

export function buildFileSearchPlaceholderBlock(filePath: string, stats: { size: number }) {
  // TODO: 实现 OpenAI File Search 风格的最小索引流程：解析文本 -> 分块 -> 关键词/语义检索 -> rerank -> 仅把相关片段注入上下文；接入 tokenizer 后精确执行 MAX_TEXT_DOCUMENT_TOKENS 文本文档上限。
  return `<file path="${escapeXmlAttribute(filePath)}" handling="file-search-placeholder" size="${escapeXmlAttribute(formatFileSize(stats.size))}">
<summary>
该文本未作为基础 File input 全文注入：文件大小或本次上传总量已超出 ${formatFileSize(MAX_DIRECT_FILE_INPUT_TOTAL_BYTES)} 的直接输入预算。当前版本尚未建立向量索引，agent 应使用 read/grep/find/ls 等文件工具按需读取原文件，不能声称已完整逐字阅读全文。
</summary>
<metadata>
文件名：${escapeXmlText(path.basename(filePath))}
文件大小：${escapeXmlText(formatFileSize(stats.size))}
参考限制：OpenAI 文件上传硬上限 ${escapeXmlText(formatFileSize(MAX_CONTEXT_FILE_BYTES))}；文本/文档目标上限约 ${MAX_TEXT_DOCUMENT_TOKENS.toLocaleString()} tokens。
</metadata>
</file>`;
}

export function buildOversizedFileBlock(filePath: string, stats: { size: number }) {
  return `<file path="${escapeXmlAttribute(filePath)}" skipped="true" reason="file-too-large" size="${escapeXmlAttribute(formatFileSize(stats.size))}">文件超过 ${formatFileSize(MAX_CONTEXT_FILE_BYTES)} 的参考上传上限，未发送给模型。请拆分、压缩，或选择更小的文件。</file>`;
}

export function buildOversizedImageBlock(filePath: string, stats: { size: number }, maxPromptImageBytes: number) {
  return `<file path="${escapeXmlAttribute(filePath)}" kind="image" skipped="true" reason="image-too-large" size="${escapeXmlAttribute(formatFileSize(stats.size))}">图片超过 ${formatFileSize(maxPromptImageBytes)}，未发送给模型。请压缩、裁剪，或改用更小的图片后重试。</file>`;
}
