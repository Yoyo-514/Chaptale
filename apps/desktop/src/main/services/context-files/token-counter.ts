/** 与 pi-coding-agent 保持一致：使用 chars / 4 对文本 token 数进行保守估算。 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function isTextWithinTokenLimit(text: string, tokenLimit: number): boolean {
  return estimateTextTokens(text) <= tokenLimit;
}
