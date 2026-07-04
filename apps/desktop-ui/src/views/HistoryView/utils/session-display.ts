import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

export function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function getSessionTitle(session: ChaptaleSessionListItem) {
  return session.name || session.lastMessagePreview || '未命名会话';
}
