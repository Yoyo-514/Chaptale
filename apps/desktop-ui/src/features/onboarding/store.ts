import { defineStore } from 'pinia';
import { ref } from 'vue';

export const ONBOARDING_VERSION = 1;
export const useOnboardingStore = defineStore('onboarding', () => {
  const isOpen = ref(false);
  const step = ref('workspace');
  let checked = false;
  function show() {
    checked = true;
    step.value = 'workspace';
    isOpen.value = true;
  }
  function consider(completedVersion: number | undefined) {
    if (checked) return;
    checked = true;
    if ((completedVersion ?? 0) < ONBOARDING_VERSION) show();
  }
  return { isOpen, step, show, consider };
});
