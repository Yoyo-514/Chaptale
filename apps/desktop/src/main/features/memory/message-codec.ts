const MEMORY_ENVELOPE_PATTERN = /^<memory\b[^>]*>\r?\n[\s\S]*?\r?\n<\/memory>\r?\n\r?\n?/;

/**
 * 从用户消息开头拆出 memory 注入信封。
 *
 * 与 context 信封同模式：只识别完整且位于开头的信封；
 * UI 展示与历史复用都不应看到注入块，promptPrefix 仅用于逐字重现原 prompt。
 */
export function decodeMemoryMessage(text: string) {
  const envelope = MEMORY_ENVELOPE_PATTERN.exec(text);

  if (!envelope) {
    return { text, promptPrefix: '' };
  }

  return {
    text: text.slice(envelope[0].length),
    promptPrefix: envelope[0]
  };
}
