import { describe, expect, it } from 'vitest';

import { formatNotificationTime, getNotificationIcon } from '../../utils/notification-display';

describe('notification-display', () => {
  it('maps notification kinds to stable visual icons', () => {
    expect(getNotificationIcon('error')).toBe('i-mingcute-warning-line');
    expect(getNotificationIcon('success')).toBe('i-mingcute-check-circle-line');
    expect(getNotificationIcon('info')).toBe('i-mingcute-information-line');
  });

  it('formats timestamps as a short user-visible time', () => {
    const formatted = formatNotificationTime(new Date('2026-07-06T08:05:00Z').getTime());

    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});
