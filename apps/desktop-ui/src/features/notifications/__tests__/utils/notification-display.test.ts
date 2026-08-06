import { describe, expect, it } from 'vitest';

import { formatNotificationTime, getNotificationIcon } from '../../utils/notification-display';

describe('notification-display', () => {
  it('maps notification kinds to stable visual icons', () => {
    expect(getNotificationIcon('error')).toBe('i-mingcute-warning-line');
    expect(getNotificationIcon('success')).toBe('i-mingcute-check-circle-line');
    expect(getNotificationIcon('info')).toBe('i-mingcute-information-line');
  });

  it('formats timestamps as a short user-visible time', () => {
    const timestamp = new Date('2026-07-06T08:05:00Z').getTime();
    const expected = new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    // 必须输出与 hour/minute 选项一致的短时间（时区无关，避免 CI 与本地时区差异）。
    expect(formatNotificationTime(timestamp)).toBe(expected);
    expect(formatNotificationTime(timestamp)).toMatch(/\d{1,2}:\d{2}/);
  });
});
