import { describe, expect, it } from 'vitest';

import { nextWindowZoom } from '../window-zoom';

describe('窗口缩放', () => {
  it('可放大至 200%，并始终能还原为 100%', () => {
    let value = 1;
    for (let i = 0; i < 10; i++) value = nextWindowZoom(value, 'in');
    expect(value).toBe(2);
    expect(nextWindowZoom(value, 'reset')).toBe(1);
  });
  it('缩小有下限，异常输入恢复默认值', () => {
    expect(nextWindowZoom(0.75, 'out')).toBe(0.75);
    expect(nextWindowZoom(1, 'out')).toBe(0.9);
    expect(nextWindowZoom(Number.NaN, 'in')).toBe(1);
  });
});
