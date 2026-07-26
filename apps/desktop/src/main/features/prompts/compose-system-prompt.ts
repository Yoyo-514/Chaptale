/**
 * 系统提示词分层拼装。
 *
 * 层次：
 *   1. persona 层：persona 文件正文；用户 SYSTEM.md 存在时整体替换本层（仅本层）。
 *   2. 产品职责层：Chaptale 固定拼装，用户文件不可触及；当前为空位，随功能填充。
 *   3. memory 协议层：静态读写规则。协议只含规则不含数据——
 *      记忆数据走 user message 前缀注入，绝不进 systemPrompt（保护 prompt cache）。
 *
 * 缓存约束：本函数对同一输入完全确定，不得引入任何随轮次变化的动态内容。
 * APPEND_SYSTEM.md 不经此函数——由 pi 原生发现并追加在最终提示词末尾。
 */
export type ComposeSystemPromptOptions = {
  /** persona 文件正文（系统提示词模板）。 */
  personaBody: string;
  /** pi 发现的用户 SYSTEM.md 内容；非空时整体替换 persona 层。 */
  discoveredSystemMd?: string;
  /** 产品职责层内容；当前无内容，参数先行保证拼装顺序被测试锁定。 */
  productDuty?: string;
  /** memory 协议层内容。 */
  memoryProtocol?: string;
  /** todo 协议层内容；仅挂载了 todo_write 工具的会话注入。 */
  todoProtocol?: string;
};

export function composeSystemPrompt(options: ComposeSystemPromptOptions): string {
  const personaLayer = options.discoveredSystemMd?.trim() ? options.discoveredSystemMd : options.personaBody;

  return [personaLayer, options.productDuty, options.memoryProtocol, options.todoProtocol]
    .map(layer => layer?.trim())
    .filter((layer): layer is string => Boolean(layer))
    .join('\n\n');
}
