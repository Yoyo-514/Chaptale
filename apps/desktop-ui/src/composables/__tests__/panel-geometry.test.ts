import { describe, expect, it } from 'vitest';

import { fitPanelToViewport } from '../panel-geometry';

const bounds = { minX: 16, minY: 16, minWidth: 680, minHeight: 420, viewportPadding: 16 };
const rect = { x: 88, y: 72, width: 832, height: 544 };

describe('面板视口约束', () => {
  it('桌面尺寸不改变已在视口内的面板', () => {
    expect(fitPanelToViewport(rect, bounds, { width: 1440, height: 900 })).toEqual(rect);
  });
  it.each([
    { width: 960, height: 640 },
    { width: 640, height: 426 },
    { width: 480, height: 320 }
  ])('桌面窗口缩放至 $width x $height 时保持面板可达', viewport => {
    const fitted = fitPanelToViewport(rect, bounds, viewport);
    expect(fitted.x).toBeGreaterThanOrEqual(16);
    expect(fitted.y).toBeGreaterThanOrEqual(16);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(viewport.width - 16);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(viewport.height - 16);
  });
});
