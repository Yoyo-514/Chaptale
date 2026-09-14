import path from 'node:path';
import { compile } from 'sass';
import { afterAll, describe, expect, it } from 'vitest';

const root = document.documentElement;
const originalClass = root.className;
const styles = document.createElement('style');
styles.textContent = [
  compile(path.resolve(import.meta.dirname, '../../../styles/tokens/_primitives.scss')).css,
  compile(path.resolve(import.meta.dirname, '../../../styles/tokens/_themes.scss')).css
].join('\n');
document.head.append(styles);
afterAll(() => {
  styles.remove();
  root.className = originalClass;
});

function token(name: string): string {
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? token(alias[1]!) : value;
}

function luminance(color: string): number {
  expect(color).toMatch(/^#[\da-f]{6}$/i);
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(token(foreground)), luminance(token(background))].toSorted((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe.each(['theme-light', 'theme-warm', 'dark'])('%s 对比度', theme => {
  it('正文、辅助文字和状态颜色在工作表面满足 WCAG 2.2 AA', () => {
    root.className = theme;
    for (const background of [
      '--background',
      '--surface',
      '--surface-elevated',
      '--surface-muted',
      '--surface-hover',
      '--sidebar'
    ]) {
      for (const foreground of ['--foreground', '--muted-foreground', '--destructive', '--warning', '--success']) {
        expect(contrast(foreground, background), `${theme} ${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('动作、选中态和输入提示满足文本对比度', () => {
    root.className = theme;
    for (const [foreground, background] of [
      ['--primary-foreground', '--primary'],
      ['--primary-foreground', '--primary-hover'],
      ['--primary-foreground', '--primary-active'],
      ['--primary-solid-foreground', '--primary-solid'],
      ['--primary-solid-foreground', '--primary-solid-hover'],
      ['--secondary-foreground', '--secondary'],
      ['--accent-foreground', '--accent'],
      ['--accent-sakura-foreground', '--accent-sakura'],
      ['--accent-mint-foreground', '--accent-mint'],
      ['--selection-foreground', '--selection-background'],
      ['--destructive-foreground', '--destructive'],
      ['--destructive-background-foreground', '--destructive-background'],
      ['--input-placeholder', '--input']
    ]) {
      expect(contrast(foreground!, background!), `${theme} ${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('输入边界与焦点不依赖低对比装饰分隔线', () => {
    root.className = theme;
    for (const background of ['--background', '--surface', '--surface-elevated', '--sidebar', '--input']) {
      expect(contrast('--ring', background), `${theme} ring/${background}`).toBeGreaterThanOrEqual(3);
      expect(contrast('--input-border', background), `${theme} input-border/${background}`).toBeGreaterThanOrEqual(3);
    }
  });
});
