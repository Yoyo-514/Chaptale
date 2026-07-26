import protocol from './prompts/protocol.md?raw';

/**
 * memory 协议：接入 composeSystemPrompt 的 memoryProtocol 层。
 * 只含"怎么做"的规则，不含任何记忆数据（数据走 user message 前缀注入块），
 * 保证 systemPrompt 会话内不变、prompt cache 稳定命中。正文见 prompts/protocol.md。
 */
export const MEMORY_PROTOCOL = protocol.replace(/\r\n/g, '\n').trim();
