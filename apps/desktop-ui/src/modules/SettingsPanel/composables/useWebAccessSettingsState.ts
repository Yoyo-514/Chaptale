import type { PiWebAccessProvider, PiWebAccessSettings, PiWebAccessWorkflow } from '@chaptale/ipc-contract';
import { klona } from 'klona';
import { computed, reactive, watch } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import { useSettingsStore } from '@/stores/settings';
import {
  createDefaultWebAccessSettings,
  normalizeWebAccessSettings,
  webAccessProviders,
  webAccessWorkflows
} from '../utils/web-access-settings';

/** WebAccessSettings 区块的草稿状态、派生可见性与保存动作。 */
export function useWebAccessSettingsState() {
  const settingsStore = useSettingsStore();
  const notificationStore = useNotificationStore();

  const providers = webAccessProviders;
  const workflows = webAccessWorkflows;

  const draft = reactive<PiWebAccessSettings>(createDefaultWebAccessSettings());
  const sections = reactive({
    keys: true,
    gemini: false,
    content: true
  });

  watch(
    () => settingsStore.state?.webAccess,
    value => {
      Object.assign(draft, normalizeWebAccessSettings(value));
    },
    { immediate: true }
  );

  const showCuratorOptions = computed(() => draft.workflow === 'summary-review');
  const showSummaryOptions = computed(() => draft.workflow !== 'none');
  const usesGeminiFeatures = computed(
    () => draft.provider === 'gemini' || draft.youtube.enabled || draft.video.enabled
  );
  const showBrowserCookieOptions = computed(() => usesGeminiFeatures.value);
  const activeProvider = computed(() => providers.find(provider => provider.value === draft.provider));
  const activeWorkflow = computed(() => workflows.find(workflow => workflow.value === draft.workflow));
  const visibleKeyProviders = computed(() =>
    providers.filter(provider => provider.value !== 'auto' && isProviderKeyVisible(provider.value))
  );
  const isLoading = computed(() => settingsStore.isLoading);

  function isProviderKeyVisible(provider: Exclude<PiWebAccessProvider, 'auto'>) {
    if (draft.provider === 'auto' || draft.provider === provider) {
      return true;
    }

    return provider === 'gemini' && usesGeminiFeatures.value;
  }

  function selectProvider(provider: PiWebAccessProvider) {
    draft.provider = provider;
  }

  function selectWorkflow(workflow: PiWebAccessWorkflow) {
    draft.workflow = workflow;
  }

  async function save() {
    // 发送深拷贝快照，避免保存进行中继续编辑嵌套字段时改变本次 IPC payload。
    await settingsStore.updateWebAccess(klona(draft));
    notificationStore.success('联网能力设置已保存');
  }

  function resetToSafeDefaults() {
    Object.assign(draft, createDefaultWebAccessSettings());
  }

  return {
    providers,
    workflows,
    draft,
    sections,
    isLoading,
    showCuratorOptions,
    showSummaryOptions,
    usesGeminiFeatures,
    showBrowserCookieOptions,
    activeProvider,
    activeWorkflow,
    visibleKeyProviders,
    selectProvider,
    selectWorkflow,
    save,
    resetToSafeDefaults
  };
}
