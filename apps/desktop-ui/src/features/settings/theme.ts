import type { ChaptaleTheme } from '@chaptale/ipc-contract';
import { isChaptaleTheme } from '@chaptale/ipc-contract';

/**
 * 主题对应的 <html> 类名。
 *
 * `dark` 同时是 UnoCSS 暗色变体的选择器（组件里有 `dark:` 前缀在用），换名字会连带失效，
 * 所以这一项与另外两项的命名不对称是有意的。
 */
const THEME_CLASS_NAMES: Record<ChaptaleTheme, string> = {
  light: 'theme-light',
  warm: 'theme-warm',
  dark: 'dark'
};

/**
 * 启动期主题缓存的键。
 *
 * 事实源始终是主进程的 settings.json——这份缓存只用来在设置经 IPC 到达之前把类挂对，
 * 设置一到就以它为准并回写这里。不要把它当成第二个事实源读写。
 */
const THEME_CACHE_KEY = 'chaptale.theme';

/** 换掉 <html> 上的主题类；只动这三个类名，页面上其他类不受影响。 */
export function applyTheme(theme: ChaptaleTheme): void {
  const root = document.documentElement;

  root.classList.remove(...Object.values(THEME_CLASS_NAMES));
  root.classList.add(THEME_CLASS_NAMES[theme]);
}

/** 读启动期缓存；没有或认不出时返回 undefined，由 index.html 上的静态类兜底。 */
export function readCachedTheme(): ChaptaleTheme | undefined {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    return isChaptaleTheme(cached) ? cached : undefined;
  } catch {
    // localStorage 不可用（隐私模式等）时当作没有缓存，功能不受影响。
    return undefined;
  }
}

export function cacheTheme(theme: ChaptaleTheme): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // 缓存只是省掉启动时的一次跳色，写不进去不影响主题本身。
  }
}
