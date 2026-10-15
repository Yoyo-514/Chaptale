import type { AgentSession } from '@earendil-works/pi-coding-agent';

import type { ChatMessage } from '../protocol.ts';

export type SdkMessage = AgentSession['messages'][number];

/** 只投影界面需要的消息内容，不跨桥接复制 SDK、模型配置或媒体原件。 */
export function messageView(message: SdkMessage): ChatMessage {
  const view: ChatMessage = { role: message.role, text: '', thinking: '', tools: [] };
  if ('toolName' in message) view.toolName = message.toolName;
  if ('isError' in message) view.error = message.isError;
  if (!('content' in message)) return view;
  if (typeof message.content === 'string') {
    view.text = message.content;
    return view;
  }
  for (const block of message.content) {
    if (block.type === 'text') view.text += block.text;
    else if (block.type === 'thinking') view.thinking += block.thinking;
    else if (block.type === 'toolCall') view.tools.push({ id: block.id, name: block.name, input: block.arguments });
    else if (block.type === 'image') view.text += '\n[图片内容；当前会话界面尚不提供附件预览]\n';
  }
  return view;
}
