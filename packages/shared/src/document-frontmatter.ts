import { isMap, isScalar, parseDocument, stringify } from 'yaml';

export type DocumentFrontmatter =
  | { status: 'none'; body: string }
  | { status: 'invalid'; body: string; error: string }
  | { status: 'ok'; frontmatter: Record<string, unknown>; body: string };
const MAX_HEAD_BYTES = 64 * 1024;
const byteLength = (text: string) => new TextEncoder().encode(text).length;

function headRange(content: string) {
  const bom = content.startsWith('\uFEFF') ? 1 : 0;
  const opening = content.startsWith('---\r\n', bom) ? 5 : content.startsWith('---\n', bom) ? 4 : 0;
  if (!opening) return null;
  const start = bom + opening;
  const closing = /^---(?:\r?\n|$)/m.exec(content.slice(start, start + MAX_HEAD_BYTES + 8));
  if (!closing) throw new Error('frontmatter 未闭合或超过 64 KiB');
  const end = start + closing.index;
  if (byteLength(content.slice(start, end)) > MAX_HEAD_BYTES) throw new Error('frontmatter 超过 64 KiB');
  return { bom, start, end, bodyStart: end + closing[0].length, eol: opening === 5 ? '\r\n' : '\n' };
}
function parseHead(source: string) {
  const document = parseDocument(source, { schema: 'core', uniqueKeys: true, keepSourceTokens: true });
  const diagnostic = document.errors[0] ?? document.warnings[0];
  if (diagnostic) throw new Error(diagnostic.message);
  if (
    document.contents !== null &&
    (!isMap(document.contents) ||
      document.contents.items.some(item => !isScalar(item.key) || typeof item.key.value !== 'string'))
  )
    throw new Error('frontmatter 必须是以字符串为键的 YAML 对象');
  document.toJS({ maxAliasCount: 0 });
  return document;
}

export function parseDocumentFrontmatter(content: string): DocumentFrontmatter {
  try {
    const range = headRange(content);
    if (!range) return { status: 'none', body: content };
    const document = parseHead(content.slice(range.start, range.end));
    return {
      status: 'ok',
      frontmatter: document.toJS({ maxAliasCount: 0 }) ?? {},
      body: content.slice(range.bodyStart)
    };
  } catch (error) {
    return { status: 'invalid', body: content, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 正文编辑保留原始元数据、注释、BOM 与换行格式。 */
export function replaceDocumentBody(content: string, body: string): string {
  const parsed = parseDocumentFrontmatter(content);
  if (parsed.status === 'invalid') throw new Error(parsed.error);
  const range = headRange(content);
  if (!range) return body;
  return content.slice(0, range.bodyStart) + body.replace(/\r?\n/g, range.eol);
}

/** 只替换指定 pair 的源码范围；未知字段和正文从原字符串直接保留。null 表示删除。 */
export function patchDocumentFields(content: string, values: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(values);
  if (
    entries.some(
      ([key]) => !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)
    )
  )
    throw new Error('字段名称不合法');
  const range = headRange(content);
  if (!range) {
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const head = stringify(Object.fromEntries(entries.filter(([, value]) => value !== null)));
    if (byteLength(head) > MAX_HEAD_BYTES) throw new Error('frontmatter 超过 64 KiB');
    return `${bom}---${eol}${head.replace(/\n/g, eol)}---${eol}${content.slice(bom.length)}`;
  }
  const source = content.slice(range.start, range.end);
  const document = parseHead(source);
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let appended = '';
  for (const [key, value] of entries) {
    const serialized = value === null ? '' : stringify({ [key]: value }).replace(/\n/g, range.eol);
    const pair = isMap(document.contents)
      ? document.contents.items.find(item => isScalar(item.key) && item.key.value === key)
      : undefined;
    if (!pair) {
      appended += serialized;
      continue;
    }
    const start = isScalar(pair.key) ? pair.key.range?.[0] : undefined;
    const node = pair.value;
    const end = node && typeof node === 'object' && 'range' in node ? node.range?.[2] : undefined;
    if (start === undefined || end === undefined) throw new Error(`字段 ${key} 无法安全投影，请使用源文件编辑`);
    changes.push({ from: range.start + start, to: range.start + end, insert: serialized });
  }
  if (appended) changes.push({ from: range.end, to: range.end, insert: appended });
  // oxlint-disable-next-line unicorn/no-array-sort
  changes.sort((a, b) => b.from - a.from);
  let result = content;
  for (const change of changes) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  const parsed = parseDocumentFrontmatter(result);
  if (parsed.status !== 'ok') throw new Error(parsed.status === 'invalid' ? parsed.error : '字段投影失败');
  return result;
}
