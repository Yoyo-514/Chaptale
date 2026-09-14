export type PanelRect = { x: number; y: number; width: number; height: number };
export type PanelBounds = {
  minX: number;
  minY: number;
  minWidth: number;
  minHeight: number;
  viewportPadding: number;
};

/** 最小尺寸是偏好，不得大于实际视口；缩放界面后同样保证关闭按钮可达。 */
export function fitPanelToViewport(
  rect: PanelRect,
  bounds: PanelBounds,
  viewport: { width: number; height: number }
): PanelRect {
  function axis(origin: number, size: number, minOrigin: number, minSize: number, extent: number) {
    const start = Math.min(minOrigin, Math.max(0, extent - 1));
    const maximum = Math.max(1, extent - start - bounds.viewportPadding);
    const minimum = Math.min(minSize, maximum);
    const fitted = Math.max(minimum, Math.min(size, extent - bounds.viewportPadding - origin, maximum));
    return { origin: Math.max(start, Math.min(origin, extent - bounds.viewportPadding - fitted)), size: fitted };
  }
  const x = axis(rect.x, rect.width, bounds.minX, bounds.minWidth, viewport.width);
  const y = axis(rect.y, rect.height, bounds.minY, bounds.minHeight, viewport.height);
  return { x: x.origin, y: y.origin, width: x.size, height: y.size };
}
