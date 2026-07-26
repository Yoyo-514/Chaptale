import { createRouter, createWebHashHistory } from 'vue-router';

const ChatView = () => import('@/features/chat').then(m => m.ChatView);
const HistoryView = () => import('@/features/history').then(m => m.HistoryView);

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
