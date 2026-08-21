/**
 * 增量 JSON 对象的尽力解析。
 *
 * 工具参数是边生成边到达的：`{"path":"第三章.md","content":"雨夜` 这样的半截 JSON
 * 直接 parse 必然失败。补齐未闭合的字符串与括号后再解析，让已经完整的字段
 * 立刻可展示——多数工具的主参数（path / url / query）都排在最前面，
 * 于是"正在写入 第三章.md"能在正文还在生成时就显示出来。
 *
 * 只做补齐，不做猜测：补不出合法 JSON 就返回 undefined，宁可先不显示，
 * 也不显示一个错的路径——作者正是据此判断 agent 在动哪个文件。
 */

type Structure = {
  /** 扫描结束时仍在字符串内。 */
  inString: boolean;
  /** 扫描结束时最后一个字符是转义符。 */
  escaped: boolean;
  /** 未闭合的括号栈。 */
  open: string[];
  /** 最外层对象里最后一个逗号的下标；-1 表示没有。 */
  lastTopLevelComma: number;
};

export function parsePartialJsonObject(raw: string): Record<string, unknown> | undefined {
  const text = raw.trimEnd();

  if (!text.startsWith('{')) {
    return undefined;
  }

  const direct = tryParseObject(text);

  if (direct) {
    return direct;
  }

  const structure = scan(text);
  const closed = tryParseObject(complete(text, structure));

  if (closed) {
    return closed;
  }

  // 末尾是个还没配上值的键（`…,"content"` 或 `…,"content":`）：
  // 整段丢掉再补齐，保住它前面那些已经完整的字段。
  if (structure.lastTopLevelComma > 0) {
    const trimmed = text.slice(0, structure.lastTopLevelComma);
    return tryParseObject(complete(trimmed, scan(trimmed)));
  }

  return undefined;
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function scan(text: string): Structure {
  const open: string[] = [];
  let inString = false;
  let escaped = false;
  let lastTopLevelComma = -1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      open.push(char);
    } else if (char === '}' || char === ']') {
      open.pop();
    } else if (char === ',' && open.length === 1 && open[0] === '{') {
      lastTopLevelComma = index;
    }
  }

  return { inString, escaped, open, lastTopLevelComma };
}

/** 补齐：去掉悬空的转义符与分隔符，闭合字符串与括号。 */
function complete(text: string, structure: Structure): string {
  let completed = structure.escaped ? text.slice(0, -1) : text;

  if (structure.inString) {
    completed += '"';
  } else {
    completed = completed.replace(/[,:]\s*$/, '');
  }

  for (let index = structure.open.length - 1; index >= 0; index -= 1) {
    completed += structure.open[index] === '{' ? '}' : ']';
  }

  return completed;
}
