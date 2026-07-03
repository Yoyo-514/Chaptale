import { createRouter, createWebHashHistory } from 'vue-router';

const ChatView = () => import('../views/ChatView/index.vue');
const HistoryView = () => import('../views/HistoryView/index.vue');

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: ChatView
    },
    {
      path: '/history',
      name: 'history',
      component: HistoryView
    }
  ]
});
