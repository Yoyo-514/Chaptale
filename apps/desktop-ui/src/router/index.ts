import { createRouter, createWebHashHistory } from 'vue-router';

const ChatView = () => import('@/features/chat').then(m => m.ChatView);
const HistoryView = () => import('../modules/AgentPanel/HistoryView/index.vue');

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
