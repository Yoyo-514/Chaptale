import type { NotificationKind } from '../store';

export function getNotificationIcon(kind: NotificationKind) {
  if (kind === 'error') return 'i-mingcute-warning-line';
  if (kind === 'success') return 'i-mingcute-check-circle-line';
  return 'i-mingcute-information-line';
}

export function formatNotificationTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}
