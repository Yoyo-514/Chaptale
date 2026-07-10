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

export function formatSessionScope(scope: ChaptaleSessionListItem['scope']) {
  return scope === 'global' ? '全局' : '工作区';
}

export function formatTokenCount(tokens: number) {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }

  return String(tokens);
}

export function formatSessionCost(cost: number) {
  if (cost <= 0) {
    return '$0';
  }

  if (cost < 0.01) {
    return '<$0.01';
  }

  return `$${cost.toFixed(2)}`;
}

/** 单条消息费用通常远小于 1 美分，保留更高精度。 */
export function formatMessageCost(cost: number) {
  if (cost <= 0) {
    return '';
  }

  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

export function formatMessageTime(timestamp?: number) {
  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();

  return new Intl.DateTimeFormat('zh-CN', {
    ...(sameDay ? {} : { month: '2-digit', day: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
