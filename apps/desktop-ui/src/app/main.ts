import '@/styles/index.scss';
import '@unocss/reset/normalize.css';
import 'virtual:uno.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import { router } from '../router';
import App from './App.vue';

// 全局错误兜底：未捕获错误至少落到控制台，避免生产环境静默失败；
// 业务级失败（IPC 拉取等）由各 composable 自行 try/catch 并回到可用空态。
window.addEventListener('unhandledrejection', event => {
  console.error('[chaptale] 未处理的 Promise 拒绝:', event.reason);
});

window.addEventListener('error', event => {
  console.error('[chaptale] 未捕获错误:', event.error ?? event.message);
});

createApp(App).use(createPinia()).use(router).mount('#root');
