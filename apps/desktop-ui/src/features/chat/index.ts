export { default as ChatToolbar } from './components/ChatToolbar.vue';
export { default as PersonaSwitchConfirmDialog } from './components/PersonaSwitchConfirmDialog.vue';
export { useChatPersona } from './composables/useChatPersona';
export const loadChatView = () => import('./ChatView.vue');
