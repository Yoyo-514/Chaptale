import type { EditorContext, SessionView } from '@chaptale/agent-host/protocol';

/**
 * 已发出、宿主尚未写入会话的作者消息。会话里的作者消息数达到 expectUsers 即视为送达；
 * pi 会展开模板，送达判断不比对文字。
 */
export interface OutgoingMessage {
  key: string;
  text: string;
  editorContext?: EditorContext;
  expectUsers: number;
  error?: string;
}

function userCount(session: SessionView) {
  return session.messages.filter(item => item.role === 'user').length;
}

/** 尚未送达或发送失败的消息。 */
export function unsentMessages(session: SessionView, list: readonly OutgoingMessage[] = []) {
  const users = userCount(session);
  return list.filter(item => item.error || users < item.expectUsers);
}

/** 追加一条待送达消息，送达条件排在仍在等待的消息之后。 */
export function enqueueMessage(
  session: SessionView,
  list: readonly OutgoingMessage[],
  text: string,
  editorContext?: EditorContext
) {
  const unsent = unsentMessages(session, list);
  const waiting = unsent.filter(item => !item.error).length;
  const message = { key: crypto.randomUUID(), text, editorContext, expectUsers: userCount(session) + waiting + 1 };
  return { message, list: [...unsent, message] };
}
