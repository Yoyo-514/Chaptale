export function escapeXmlAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

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
