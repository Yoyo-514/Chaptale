import { type AgentSession, type SessionManager, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';

import { type ChatMessage, reviewResultsMessageType } from '../protocol.ts';

export type SdkMessage = AgentSession['messages'][number];

/** 只投影界面需要的消息内容，不跨桥接复制 SDK、模型配置或媒体原件。 */
export function messageView(message: SdkMessage): ChatMessage {
  const view: ChatMessage = { role: message.role, text: '', thinking: '', tools: [] };
  if ('toolName' in message) view.toolName = message.toolName;
  if ('isError' in message) view.error = message.isError;
  // 处理结果携带片段与正式稿给模型；界面只显示计数和逐处摘要。
  if (message.role === 'custom' && message.customType === reviewResultsMessageType) {
    const { count, outcomes, resultIds } = message.details as {
      count: number;
      outcomes: string[];
      resultIds: string[];
    };
    view.role = 'reviewResults';
    view.text = `作者已处理 ${count} 处修改`;
    view.outcomes = outcomes.map((text, index) => ({ id: resultIds[index], text }));
    return view;
  }
  // 压缩总结只有 summary，没有 content；界面只读显示。
  if (message.role === 'compactionSummary') {
    view.text = message.summary;
    return view;
  }
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

/**
 * 按当前分支的记录顺序列出全部消息：压缩前的对话保留显示，已不在模型上下文中的标记 compacted；
 * 压缩总结出现在它被记录的位置。模型实际收到的内容仍由 pi 决定。
 */
export function transcriptView(manager: SessionManager): ChatMessage[] {
  const inContext = new Set(manager.buildContextEntries().map(entry => entry.id));
  return manager.getBranch().flatMap(entry =>
    sessionEntryToContextMessages(entry)
      .filter(message => message.role !== 'system')
      .map(message => {
        const view = messageView(message);
        if (!inContext.has(entry.id)) view.compacted = true;
        return view;
      })
  );
}
