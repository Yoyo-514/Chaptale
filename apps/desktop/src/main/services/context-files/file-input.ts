import { escapeXmlAttribute, escapeXmlText, formatFileSize } from '@chaptale/shared';

import path from 'node:path';

export function buildTextFileInputBlock(filePath: string, stats: { size: number }, text: string) {
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

export function buildDocumentFileInputBlock(filePath: string, stats: { size: number }, mimeType: string) {
  // TODO: 接入 PDF/Office 文档解析器，或在 provider 支持时改为原生 file/document content block。
  return `<file path="${escapeXmlAttribute(filePath)}" handling="document-file-input" kind="document" mimeType="${escapeXmlAttribute(mimeType)}" size="${escapeXmlAttribute(formatFileSize(stats.size))}">
<metadata>
文件名：${escapeXmlText(path.basename(filePath))}
文件大小：${escapeXmlText(formatFileSize(stats.size))}
文件类型：${escapeXmlText(mimeType)}
说明：这是用户随消息提供的文档文件。当前消息包含文件元数据与本地路径，但不包含已抽取的正文；如果任务依赖文档正文，请先使用可用文件工具读取或检索文件，不要声称已经完整阅读文档内容。
</metadata>
</file>`;
}
