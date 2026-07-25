const OMIT_MARKER = '\n…（已按 token 预算省略内容）…\n';

/** 参考 pi 的 chars/4；非 ASCII 按一字符一 token，避免严重低估中文创作文本。 */
export function estimateTextTokens(text: string): number {
  // Context File 的百万 token 边界常是纯 ASCII；先走原生正则快路径，避免逐字符扫描。
  if (isAsciiText(text)) return Math.ceil(text.length / 4);

  let ascii = 0;
  let wide = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) {
      ascii += 1;
    } else {
      wide += 1;
      if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(index + 1))) index += 1;
    }
  }

  return wide + Math.ceil(ascii / 4);
}

export function isTextWithinTokenLimit(text: string, tokenLimit: number): boolean {
  return estimateTextTokens(text) <= tokenLimit;
}

/** 从头部消费预算内文本，确保连续切片可无损还原原文。 */
export function takeTextToTokenBudget(text: string, tokenBudget: number): { head: string; rest: string } {
  const budget = Math.max(0, Math.floor(tokenBudget));
  const head = take(text, budget, false);
  return { head, rest: text.slice(head.length) };
}

/** 从尾部消费预算内文本，确保 overlap 不会拆分 Unicode 代理对。 */
export function takeTextTailToTokenBudget(text: string, tokenBudget: number): { head: string; tail: string } {
  const budget = Math.max(0, Math.floor(tokenBudget));
  const tail = take(text, budget, true);
  return { head: text.slice(0, text.length - tail.length), tail };
}

/** 超预算时保留首尾；首部通常含原始目标，尾部通常含最近决策。 */
export function fitTextToTokens(text: string, tokenBudget: number): string {
  const budget = Math.max(0, Math.floor(tokenBudget));
  if (estimateTextTokens(text) <= budget) return text;
  if (budget === 0) return '';

  const markerTokens = estimateTextTokens(OMIT_MARKER);
  if (markerTokens >= budget) return take(text, budget, false);

  const keptBudget = budget - markerTokens;
  const head = take(text, Math.ceil(keptBudget / 2), false);
  const tail = take(text, Math.floor(keptBudget / 2), true);
  const fitted = `${head}${OMIT_MARKER}${tail}`;

  return estimateTextTokens(fitted) <= budget ? fitted : take(fitted, budget, false);
}

function take(text: string, budget: number, reverse: boolean): string {
  if (budget <= 0) return '';
  if (isAsciiText(text)) {
    const chars = Math.min(text.length, budget * 4);
    return reverse ? text.slice(text.length - chars) : text.slice(0, chars);
  }

  let ascii = 0;
  let wide = 0;
  let boundary = reverse ? text.length : 0;
  let index = reverse ? text.length - 1 : 0;

  while (index >= 0 && index < text.length) {
    let size = 1;
    const code = text.charCodeAt(index);
    if (reverse && isLowSurrogate(code) && isHighSurrogate(text.charCodeAt(index - 1))) size = 2;
    if (!reverse && isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(index + 1))) size = 2;

    const nextAscii = code <= 0x7f ? ascii + 1 : ascii;
    const nextWide = code <= 0x7f ? wide : wide + 1;
    if (nextWide + Math.ceil(nextAscii / 4) > budget) break;

    ascii = nextAscii;
    wide = nextWide;
    boundary = reverse ? index - size + 1 : index + size;
    index += reverse ? -size : size;
  }

  return reverse ? text.slice(boundary) : text.slice(0, boundary);
}

function isAsciiText(text: string): boolean {
  return Buffer.byteLength(text, 'utf8') === text.length;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
