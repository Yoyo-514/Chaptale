import { isMap, isScalar, parseDocument } from 'yaml';

import type { DocumentHead } from '@chaptale/ipc-contract';

const MAX_FRONTMATTER_BYTES = 64 * 1024;

/** 作品文件允许标准 YAML；解析投影失败不影响原文，系统资产的解析规则与这里独立。 */
export function parseDocumentHead(content: string): DocumentHead {
  const start = content.startsWith('\uFEFF') ? 1 : 0;
  const openingLength = content.startsWith('---\r\n', start) ? 5 : content.startsWith('---\n', start) ? 4 : 0;
  if (!openingLength) return { status: 'none', body: content };

  const invalid = (error: string): DocumentHead => ({ status: 'invalid', body: content, error });
  const headStart = start + openingLength;
  // 只扫描有界前缀，未闭合的文件头不能把整篇长文交给 YAML 解析器。
  const prefix = content.slice(headStart, headStart + MAX_FRONTMATTER_BYTES + 8);
  const closing = /^---(?:\r?\n|$)/m.exec(prefix);
  if (!closing) return invalid('frontmatter 未闭合或超过 64 KiB');

  const headEnd = headStart + closing.index;
  const closingLength = content.startsWith('---\r\n', headEnd)
    ? 5
    : content.startsWith('---\n', headEnd)
      ? 4
      : headEnd + 3 === content.length
        ? 3
        : 0;
  const source = content.slice(headStart, headEnd);
  if (!closingLength || Buffer.byteLength(source, 'utf8') > MAX_FRONTMATTER_BYTES) {
    return invalid('frontmatter 超过 64 KiB');
  }

  try {
    const document = parseDocument(source, { schema: 'core', uniqueKeys: true });
    const diagnostic = document.errors[0] ?? document.warnings[0];
    if (diagnostic) return invalid(diagnostic.message);
    if (
      document.contents !== null &&
      (!isMap(document.contents) ||
        document.contents.items.some(item => !isScalar(item.key) || typeof item.key.value !== 'string'))
    ) {
      return invalid('frontmatter 必须是以字符串为键的 YAML 对象');
    }

    // 不展开别名，避免循环引用或指数膨胀进入 IPC；不支持的头仍可按原文打开。
    const frontmatter = (document.toJS({ maxAliasCount: 0 }) ?? {}) as Record<string, unknown>;
    return { status: 'ok', frontmatter, body: content.slice(headEnd + closingLength) };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }
}
