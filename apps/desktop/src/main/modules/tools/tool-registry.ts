import type { TodoStore } from '../todo/store';
import { createTodoWriteTool } from '../todo/tool';
import type { ToolDefinition } from './definition';

export type ChatToolContext = {
  todoStore: TodoStore;
  getSessionId: () => string | null;
};

/** 主对话会话可用的自定义工具集合；delegate / memory_* 等后续在此追加。 */
export function buildChatSessionTools(context: ChatToolContext): ToolDefinition[] {
  return [createTodoWriteTool(context) as ToolDefinition];
}
