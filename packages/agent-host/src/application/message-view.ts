import { type AgentSession, type SessionManager, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';

import { type ChatMessage, reviewResultsMessageType } from '../protocol.ts';
import { decodePromptWithContext } from './editor-context.ts';
import { toolResultInfo, type ToolTargetLookup } from './tool-result-info.ts';

export type SdkMessage = AgentSession['messages'][number];

function applyUserText(view: ChatMessage, raw: string) {
  if (view.role !== 'user') {
    view.text = raw;
    return;
  }
  const decoded = decodePromptWithContext(raw);
  view.text = decoded.text;
  if (decoded.editorContext) view.editorContext = decoded.editorContext;
}

/** 只投影界面需要的消息内容，不跨桥接复制 SDK、模型配置或媒体原件。 */
export function messageView(message: SdkMessage, target?: ToolTargetLookup): ChatMessage {
  const view: ChatMessage = { role: message.role, text: '', thinking: '', tools: [] };
  if ('toolName' in message) {
    view.toolName = message.toolName;
    view.toolCallId = message.toolCallId;
    view.toolInfo = toolResultInfo(message.details);
    if (message.nestedCalls) {
      view.nestedTools = message.nestedCalls.calls.map(call => ({
        id: call.id,
        name: call.name,
        input: call.arguments,
        status: call.status,
        error: call.error,
        info: target?.(call.arguments)
      }));
      view.nestedToolsComplete = message.nestedCalls.complete;
    }
  }
  if ('isError' in message) view.error = message.isError;
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
  if (message.role === 'compactionSummary') {
    view.text = message.summary;
    return view;
  }
  if (!('content' in message)) return view;
  if (typeof message.content === 'string') {
    applyUserText(view, message.content);
    return view;
  }
  let text = '';
  for (const block of message.content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'thinking') view.thinking += block.thinking;
    else if (block.type === 'toolCall')
      view.tools.push({ id: block.id, name: block.name, input: block.arguments, info: target?.(block.arguments) });
    else if (block.type === 'image') text += '\n[图片内容；当前会话界面尚不提供附件预览]\n';
  }
  applyUserText(view, text);
  return view;
}

/**
 * 按当前分支的记录顺序列出全部消息：压缩前的对话保留显示，已不在模型上下文中的标记 compacted；
 * 压缩总结出现在它被记录的位置。模型实际收到的内容仍由 pi 决定。
 */
export function transcriptView(manager: SessionManager, target?: ToolTargetLookup): ChatMessage[] {
  const inContext = new Set(manager.buildContextEntries().map(entry => entry.id));
  return manager.getBranch().flatMap(entry =>
    sessionEntryToContextMessages(entry)
      .filter(message => message.role !== 'system')
      .map(message => {
        const view = messageView(message, target);
        if (!inContext.has(entry.id)) view.compacted = true;
        return view;
      })
  );
}
