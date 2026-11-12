import type { ChatMessage } from '@chaptale/agent-host/protocol';

export type ToolActivity = {
  kind: 'tool';
  key: string;
  name: string;
  /** 「读取了 正文/第一章.md」这样的一句话，作者不必看参数也知道助手做了什么。 */
  summary: string;
  input: unknown;
  result?: { text: string; error: boolean };
};
export type ThinkingActivity = { kind: 'thinking'; key: string; text: string };
export type TranscriptItem =
  | { kind: 'user'; key: string; text: string; compacted?: boolean }
  /** 会话压缩总结，只读；它之前的对话已由总结代替。 */
  | { kind: 'summary'; key: string; text: string }
  /** 作者逐处处理结果，只读，完整正式稿留在模型上下文中。 */
  | { kind: 'notice'; key: string; text: string; outcomes: NonNullable<ChatMessage['outcomes']> }
  | {
      kind: 'assistant';
      key: string;
      /** 原消息下标，流式渲染按它区分缓存。 */
      index: number;
      thinking?: ThinkingActivity;
      text: string;
      error: boolean;
      tools: ToolActivity[];
      /** 已被压缩总结代替，只供查看。 */
      compacted?: boolean;
    };

const verbs: Record<string, [done: string, pending: string]> = {
  read: ['读取了', '读取'],
  ls: ['查看了目录', '查看目录'],
  find: ['查找了', '查找'],
  grep: ['搜索了', '搜索']
};

/** 工具参数里最能说明对象的那一项；未知工具只显示名称。 */
function target(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const fields = input as Record<string, unknown>;
  const value = [fields.pattern, fields.path, fields.file_path].find(item => typeof item === 'string' && item);
  const where = typeof fields.pattern === 'string' && typeof fields.path === 'string' ? ` · ${fields.path}` : '';
  return value ? `${value as string}${where}` : '';
}

/** failed：被拒绝或执行出错，不能写成“读取了”这样的完成说法。 */
export function describeTool(name: string, input: unknown, done: boolean, failed = false): string {
  const pending = verbs[name]?.[1] ?? `调用 ${name}`;
  const verb = failed ? `未能${pending}` : done ? (verbs[name]?.[0] ?? `调用了 ${name}`) : pending;
  const object = target(input);
  return object ? `${verb} ${object}` : verb;
}

/**
 * 把宿主消息整理成阅读顺序：作者消息、助手回复，工具结果并回发起它的工具行。
 * 工具结果按调用顺序依次匹配同名的待完成工具。
 */
export function buildTranscript(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const pending: ToolActivity[] = [];
  messages.forEach((message, index) => {
    const key = String(index);
    if (message.role === 'user') {
      items.push({ kind: 'user', key, text: message.text, compacted: message.compacted });
      return;
    }
    if (message.role === 'reviewResults') {
      items.push({ kind: 'notice', key, text: message.text, outcomes: message.outcomes! });
      return;
    }
    if (message.role === 'compactionSummary') {
      items.push({ kind: 'summary', key, text: message.text });
      return;
    }
    if (message.role === 'toolResult') {
      const at = pending.findIndex(tool => tool.name === message.toolName);
      const tool = at === -1 ? undefined : pending.splice(at, 1)[0];
      if (tool) {
        tool.result = { text: message.text, error: message.error === true };
        tool.summary = describeTool(tool.name, tool.input, true, message.error === true);
        return;
      }
      const orphan: ToolActivity = {
        kind: 'tool',
        key,
        name: message.toolName ?? '工具',
        summary: describeTool(message.toolName ?? '工具', undefined, true, message.error === true),
        input: undefined,
        result: { text: message.text, error: message.error === true }
      };
      items.push({
        kind: 'assistant',
        key,
        index,
        text: '',
        error: false,
        tools: [orphan],
        compacted: message.compacted
      });
      return;
    }
    const tools = message.tools.map<ToolActivity>(tool => ({
      kind: 'tool',
      key: `${key}:${tool.id}`,
      name: tool.name,
      summary: describeTool(tool.name, tool.input, false),
      input: tool.input
    }));
    pending.push(...tools);
    items.push({
      kind: 'assistant',
      key,
      index,
      thinking: message.thinking ? { kind: 'thinking', key: `${key}:thinking`, text: message.thinking } : undefined,
      text: message.text,
      error: message.error === true,
      tools,
      compacted: message.compacted
    });
  });
  return items;
}
