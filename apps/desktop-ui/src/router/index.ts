import { createRouter, createWebHashHistory } from 'vue-router';

import { loadChatView } from '@/features/chat';
import { loadHistoryView } from '@/features/history';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: loadChatView
    },
    {
      path: '/history',
      name: 'history',
      component: loadHistoryView
    }
  ]
});
