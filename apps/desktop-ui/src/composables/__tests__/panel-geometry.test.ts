import { describe, expect, it } from 'vitest';

import { fitPanelToViewport } from '../panel-geometry';

const bounds = { minX: 16, minY: 16, minWidth: 680, minHeight: 420, viewportPadding: 16 };
const rect = { x: 88, y: 72, width: 832, height: 544 };

describe('面板视口约束', () => {
  it('桌面尺寸不改变已在视口内的面板', () => {
    expect(fitPanelToViewport(rect, bounds, { width: 1440, height: 900 })).toEqual(rect);
  });
  it.each([
    { width: 390, height: 844 },
    { width: 480, height: 320 },
    { width: 320, height: 568 }
  ])('在 $width x $height 中允许小于偏好最小尺寸', viewport => {
    const fitted = fitPanelToViewport(rect, bounds, viewport);
    expect(fitted.x).toBeGreaterThanOrEqual(16);
    expect(fitted.y).toBeGreaterThanOrEqual(16);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(viewport.width - 16);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(viewport.height - 16);
  });
});
