import protocol from './prompts/protocol.md?raw';

/**
 * 任务清单协议：注入主对话系统提示词，与 memory 协议同层。
 * 只约定"何时用、怎么写、何时不用"，不描述实现细节。正文见 prompts/protocol.md。
 */
export const TODO_PROTOCOL = protocol.replace(/\r\n/g, '\n').trim();
