import '@/styles/index.scss';
import '@unocss/reset/normalize.css';
import 'virtual:uno.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from '../router';

createApp(App).use(createPinia()).use(router).mount('#root');
