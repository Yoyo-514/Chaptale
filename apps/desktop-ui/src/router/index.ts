import { createRouter, createWebHashHistory } from 'vue-router';

const ChatView = () => import('../modules/ChatView/index.vue');
const HistoryView = () => import('../modules/HistoryView/index.vue');

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
