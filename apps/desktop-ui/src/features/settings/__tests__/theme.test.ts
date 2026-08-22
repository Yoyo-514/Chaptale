import { beforeEach, describe, expect, it } from 'vitest';

import { applyTheme, cacheTheme, readCachedTheme } from '../theme';

beforeEach(() => {
  document.documentElement.className = '';
  localStorage.clear();
});

describe('applyTheme', () => {
  it('只替换主题类，页面上其他类不受影响', () => {
    document.documentElement.classList.add('dark', 'some-other-class');

    applyTheme('warm');

    expect(document.documentElement.classList.contains('theme-warm')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    // 换主题不该顺手清掉别人挂在根元素上的类。
    expect(document.documentElement.classList.contains('some-other-class')).toBe(true);
  });

  it('暗色用的类名是 dark，不带 theme- 前缀', () => {
    // 这个名字同时是 UnoCSS 暗色变体的选择器，组件里有 dark: 前缀在用，改掉会连带失效。
    applyTheme('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('readCachedTheme', () => {
  it('认不出的缓存取值当作没有缓存', () => {
    localStorage.setItem('chaptale.theme', '将来某个主题');

    expect(readCachedTheme()).toBeUndefined();
  });

  it('回读刚写入的主题', () => {
    cacheTheme('light');

    expect(readCachedTheme()).toBe('light');
  });
});
