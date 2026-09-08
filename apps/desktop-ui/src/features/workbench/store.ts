import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useWorkbenchStore = defineStore('workbench-navigation', () => {
  const sidebar = ref<'workspace' | 'structure' | 'review' | 'memory' | 'search'>('workspace');
  const auxiliary = ref<'agent' | 'references' | 'candidates' | 'review' | 'settlement' | 'assets' | 'runs'>('agent');
  return { sidebar, auxiliary };
});
