/**
 * 最小 YAML 子集解析器：自有 FrontmatterParser 端口实现。
 *
 * 支持语法（文档约定的全部格式，不支持即解析失败——宁可拒绝也不静默丢字段）：
 * - 单行标量：`key: value`（字符串 / 布尔 / 数字；值可带单双引号）
 * - 内联数组：`key: [a, b, c]`（成员为标量）
 * - 块状数组：`key:` 换行 + `- item` 列表（成员为标量；素材 md 的 aliases 常用写法）
 * - 两级块状嵌套：`parent:` 换行 + 两空格缩进子键（子值仍为标量或内联数组）
 *
 * 其余语法（多行字符串、锚点、深嵌套等）按无效处理。
 */

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(FRONTMATTER_PATTERN);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  return {
    frontmatter: parseYamlSubset(match[1] ?? ''),
    body: content.slice(match[0]?.length ?? 0)
  };
}

function parseYamlSubset(source: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = source.split(/\r?\n/);

  let currentParent: string | null = null;
  /** 块状数组归属：最近一个无值键（可能在顶层或嵌套 map 内）。 */
  let arrayOwner: { container: Record<string, unknown>; key: string } | null = null;

  for (const [index, rawLine] of lines.entries()) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    // 块状数组项：`- item`（附属于最近的无值键）。
    const itemMatch = line.match(/^- (.+)$/);

    if (itemMatch) {
      if (!arrayOwner) {
        throw new Error(`frontmatter 第 ${index + 1} 行的列表项缺少所属键`);
      }

      const { container, key } = arrayOwner;
      const existing = container[key];

      if (Array.isArray(existing)) {
        existing.push(parseScalar(itemMatch[1] ?? ''));
      } else {
        container[key] = [parseScalar(itemMatch[1] ?? '')];
      }

      continue;
    }

    if (indent > 0 && !currentParent) {
      throw new Error(`frontmatter 第 ${index + 1} 行出现意外缩进`);
    }

    // 无值键：`key:`（顶层或嵌套内，后续可能是块状数组或嵌套 map）。
    const parentMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);

    if (parentMatch) {
      const key = parentMatch[1] ?? '';

      if (indent === 0) {
        currentParent = key;
        result[key] = {};
        arrayOwner = { container: result, key };
      } else if (currentParent) {
        (result[currentParent] as Record<string, unknown>)[key] = {};
        arrayOwner = { container: result[currentParent] as Record<string, unknown>, key };
      } else {
        throw new Error(`frontmatter 第 ${index + 1} 行出现意外缩进`);
      }

      continue;
    }

    // 键值行。
    const entryMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);

    if (!entryMatch) {
      throw new Error(`frontmatter 第 ${index + 1} 行无法解析：${line}`);
    }

    const key = entryMatch[1] ?? '';
    const rawValue = entryMatch[2] ?? '';

    if (indent === 0) {
      result[key] = parseValue(rawValue);
      currentParent = null;
    } else if (currentParent) {
      (result[currentParent] as Record<string, unknown>)[key] = parseValue(rawValue);
    } else {
      throw new Error(`frontmatter 第 ${index + 1} 行出现意外缩进`);
    }

    arrayOwner = null;
  }

  return result;
}

function parseValue(raw: string): unknown {
  const value = raw.trim();

  // 内联数组：`[a, b, c]`。
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();

    if (!inner) {
      return [];
    }

    return inner.split(',').map(item => parseScalar(item.trim()));
  }

  return parseScalar(value);
}

function parseScalar(value: string): string | boolean | number {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}
