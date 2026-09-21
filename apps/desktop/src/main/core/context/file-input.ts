import path from 'node:path';

import { escapeXmlAttribute, escapeXmlText, formatFileSize } from '@chaptale/shared';

import type { DocumentNoTextReason } from './document-parser-port';

export function buildTextInput(filePath: string, stats: { size: number }, text: string) {
  return `<file path="${escapeXmlAttribute(filePath)}" handling="file-input-text" size="${escapeXmlAttribute(formatFileSize(stats.size))}">
<metadata>
文件名：${escapeXmlText(path.basename(filePath))}
文件大小：${escapeXmlText(formatFileSize(stats.size))}
说明：这是用户随消息提供的文件内容。请把 <content> 中的文本视为当前对话的已提供资料；回答与分析应优先基于这些资料本身。
</metadata>
<content>
${escapeXmlText(text)}
</content>
</file>`;
}

export function buildDocInput(filePath: string, stats: { size: number }, mimeType: string, text: string) {
  return `<file path="${escapeXmlAttribute(filePath)}" handling="document-file-input" kind="document" mimeType="${escapeXmlAttribute(mimeType)}" size="${escapeXmlAttribute(formatFileSize(stats.size))}">
<metadata>
文件名：${escapeXmlText(path.basename(filePath))}
文件大小：${escapeXmlText(formatFileSize(stats.size))}
文件类型：${escapeXmlText(mimeType)}
说明：这是从用户随消息提供的文档中确定性提取的原生文本；不包含图片 OCR 结果。
</metadata>
<content>
${escapeXmlText(text)}
</content>
</file>`;
}

export function buildUnsupportedDoc(filePath: string, stats: { size: number }, mimeType: string) {
  return buildSkippedDoc(
    filePath,
    stats,
    mimeType,
    'document-format-unsupported',
    '当前解析器不支持该旧版文档格式，未提取正文。请将文件另存为 PDF、DOCX、PPTX 或 XLSX 后重试。'
  );
}

export function buildDocParseError(filePath: string, stats: { size: number }, mimeType: string) {
  return buildSkippedDoc(
    filePath,
    stats,
    mimeType,
    'document-parse-failed',
    '文档正文解析失败，未向模型提供文档内容。请检查文件是否损坏或受密码保护。'
  );
}

/** 无文本时的提示文案；归因缺失（仅文本为空、无相关警告）时按最常见的扫描件说明。 */
const NO_TEXT_MESSAGES: Record<DocumentNoTextReason, string> = {
  scanned: '文档中没有可提取的原生文本；它可能是扫描件或文字位于图片中。应用不使用 OCR，未向模型提供文档正文。',
  unreadable:
    '文档的文字层无法可靠解码，解析器判定提取结果不可信，未向模型提供文档正文。这通常由 PDF 缺少字形映射导致，请重新导出该文档后重试。'
};

export function buildDocNoText(
  filePath: string,
  stats: { size: number },
  mimeType: string,
  noTextReason?: DocumentNoTextReason
) {
  return buildSkippedDoc(filePath, stats, mimeType, 'document-no-text', NO_TEXT_MESSAGES[noTextReason ?? 'scanned']);
}

export function buildDocTooLarge(filePath: string, stats: { size: number }, mimeType: string, maxBytes: number) {
  return buildSkippedDoc(
    filePath,
    stats,
    mimeType,
    'document-too-large',
    `文档超过 ${formatFileSize(maxBytes)} 的本地解析上限，未向模型提供文档正文。请拆分或压缩后重试。`
  );
}

export function buildDocTextLimit(filePath: string, stats: { size: number }, mimeType: string) {
  return buildSkippedDoc(
    filePath,
    stats,
    mimeType,
    'document-text-too-large',
    '文档已解析，但提取文本超过本次上下文预算，未向模型提供正文。请拆分文档后重试。'
  );
}

function buildSkippedDoc(filePath: string, stats: { size: number }, mimeType: string, reason: string, message: string) {
  return `<file path="${escapeXmlAttribute(filePath)}" kind="document" mimeType="${escapeXmlAttribute(mimeType)}" skipped="true" reason="${reason}" size="${escapeXmlAttribute(formatFileSize(stats.size))}">${escapeXmlText(message)}</file>`;
}
