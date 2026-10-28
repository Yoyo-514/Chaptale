import type { HistoryItem, SessionView } from '@chaptale/agent-host/protocol';

export interface SessionEntry {
  key: string;
  title: string;
  /** 历史文件的最近修改时间；尚未写入历史的新会话为空。 */
  modified: string;
  workId: string | null;
  live?: SessionView;
  item?: HistoryItem;
}

export function sessionTitle(session: SessionView): string {
  return (
    session.name ||
    session.messages.find(message => message.role === 'user' && message.text)?.text.slice(0, 32) ||
    '未命名会话'
  );
}

/** 原生历史与尚未写入历史的打开会话合并为一个列表，按最近修改排列，新会话在前。 */
export function sessionEntries(
  history: readonly HistoryItem[],
  sessions: readonly SessionView[],
  owner: (sessionId: string | null) => string | null
): SessionEntry[] {
  const list: SessionEntry[] = history.map(item => {
    const live = sessions.find(session => session.sessionId === item.id);
    return {
      key: item.id,
      title: live ? sessionTitle(live) : item.title,
      modified: item.modified,
      workId: owner(item.id),
      live,
      item
    };
  });
  for (const live of sessions)
    if (!list.some(entry => entry.live === live))
      list.push({ key: live.id, title: sessionTitle(live), modified: '', workId: owner(live.sessionId), live });
  return list.toSorted((a, b) => (b.modified || '~').localeCompare(a.modified || '~'));
}
