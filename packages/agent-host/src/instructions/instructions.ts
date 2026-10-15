import type { ContextEvent, ExtensionContext } from '@earendil-works/pi-coding-agent';

import { type AgentInstructions, type EditMode, editModes } from '../protocol.ts';

type ContextMessage = ContextEvent['messages'][number];
type ContextModel = NonNullable<ExtensionContext['model']>;

const roles = new Set(['system', 'user', 'assistant']);

/** 校验并复制一套指令，只保留契约字段；界面命令、应用设置与会话历史都经过这里。 */
export function normalizeInstructions(value: unknown): AgentInstructions {
  if (!Array.isArray(value)) throw new Error('Agent 指令必须是条目列表');
  const entries = value.map(entry => {
    if (
      !entry ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      !roles.has(entry.role) ||
      typeof entry.text !== 'string' ||
      !entry.text.trim() ||
      typeof entry.enabled !== 'boolean'
    ) {
      throw new Error('Agent 指令条目需要名称、角色、非空正文和启用状态');
    }
    return { name: entry.name, role: entry.role, text: entry.text, enabled: entry.enabled };
  });
  if (!entries.some(entry => entry.enabled && entry.role === 'system')) {
    throw new Error('Agent 指令至少需要一个启用的 system 条目');
  }
  return entries;
}

export function normalizeMode(value: unknown): EditMode {
  if (!editModes.includes(value as EditMode)) throw new Error('修改模式无效');
  return value as EditMode;
}

/** 启用的 system 条目按顺序拼接为系统提示词。 */
export function systemPrompt(entries: AgentInstructions): string {
  return entries
    .filter(entry => entry.enabled && entry.role === 'system')
    .map(entry => entry.text)
    .join('\n\n');
}

/**
 * 启用的 user/assistant 条目转为对话前缀，只用于本次请求，不写入 JSONL。
 * 时间戳与用量固定为 0，assistant 条目沿用当前模型身份，保证请求前缀稳定以命中缓存。
 */
export function prefixMessages(entries: AgentInstructions, model: ContextModel): ContextMessage[] {
  return entries.flatMap((entry): ContextMessage[] => {
    if (!entry.enabled || entry.role === 'system') return [];
    if (entry.role === 'user') return [{ role: 'user', content: entry.text, timestamp: 0 }];
    return [
      {
        role: 'assistant',
        content: [{ type: 'text', text: entry.text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp: 0
      }
    ];
  });
}
