import type { EditorContext, QueuedDelivery, SessionView } from '@chaptale/agent-host/protocol';

/**
 * 已发出、宿主尚未写入会话的作者消息。空闲发送以作者消息数达到 expectUsers 视为送达；
 * 运行中排队发送在请求飞行期间显示，宿主接收入队后交由 session.queued 展示，拒收时保留错误供重试。
 */
export interface OutgoingMessage {
  key: string;
  text: string;
  editorContext?: EditorContext;
  delivery?: QueuedDelivery;
  queuedInflight?: boolean;
  expectUsers: number;
  error?: string;
}

function userCount(session: SessionView) {
  return session.messages.filter(item => item.role === 'user').length;
}

/** 尚未送达或发送失败的消息。 */
export function unsentMessages(session: SessionView, list: readonly OutgoingMessage[] = []) {
  const users = userCount(session);
  return list.filter(item => item.error || item.queuedInflight || (!item.delivery && users < item.expectUsers));
}

/** 追加一条待送达消息，送达条件排在仍在等待的消息之后。 */
export function enqueueMessage(
  session: SessionView,
  list: readonly OutgoingMessage[],
  text: string,
  editorContext?: EditorContext,
  delivery?: QueuedDelivery
) {
  const unsent = unsentMessages(session, list);
  const waiting = unsent.filter(item => !item.error && !item.delivery).length;
  const message: OutgoingMessage = {
    key: crypto.randomUUID(),
    text,
    editorContext,
    ...(delivery && { delivery, queuedInflight: true }),
    expectUsers: userCount(session) + waiting + 1
  };
  return { message, list: [...unsent, message] };
}
