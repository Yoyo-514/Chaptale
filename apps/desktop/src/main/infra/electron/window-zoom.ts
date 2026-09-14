import type { WindowZoomCommand } from '@chaptale/ipc-contract';

const ZOOM_LEVELS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** 覆盖 WCAG 200% 放大，同时保留确定的重置入口与上下限。 */
export function nextWindowZoom(current: number, command: WindowZoomCommand): number {
  if (command === 'reset' || !Number.isFinite(current)) return 1;
  return command === 'in'
    ? (ZOOM_LEVELS.find(value => value > current + 0.001) ?? 2)
    : (ZOOM_LEVELS.findLast(value => value < current - 0.001) ?? 0.75);
}
