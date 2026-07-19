/** 转义双引号属性值中的 XML 保留字符，用于应用生成的上下文文件信封。 */
export function escapeXmlAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 转义 XML 文本节点；引号在文本节点中无需替换。 */
export function escapeXmlText(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function unescapeXmlAttribute(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

const ATTRIBUTE_PATTERN = /([\w:-]+)="([^"]*)"/g;

/** 解析 `key="value"` 形式的 XML 属性串，属性值做反转义。 */
export function parseXmlAttributes(source: string) {
  const attributes: Record<string, string> = {};

  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1]!] = unescapeXmlAttribute(match[2]!);
  }

  return attributes;
}
