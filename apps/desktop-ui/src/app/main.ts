import '@/styles/index.scss';
import '@unocss/reset/normalize.css';
import 'virtual:uno.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import { applyTheme, readCachedTheme } from '@/features/settings';

import { router } from '../router';
import App from './App.vue';

// 设置要过一次 IPC 才拿得到，赶不上首帧。先按启动期缓存把主题类挂上，
// 设置到达后由 settings store 校准；缓存缺席时沿用 index.html 上的静态类。
const cachedTheme = readCachedTheme();

if (cachedTheme) {
  applyTheme(cachedTheme);
}

// 全局错误兜底：未捕获错误至少落到控制台，避免生产环境静默失败；
// 业务级失败（IPC 拉取等）由各 composable 自行 try/catch 并回到可用空态。
window.addEventListener('unhandledrejection', event => {
  console.error('[chaptale] 未处理的 Promise 拒绝:', event.reason);
});

window.addEventListener('error', event => {
  console.error('[chaptale] 未捕获错误:', event.error ?? event.message);
});

createApp(App).use(createPinia()).use(router).mount('#root');
