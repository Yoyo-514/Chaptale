import { onMounted, watch } from 'vue';

import { useSettingsStore } from '@/features/settings';
import { useWorkspaceStore } from '@/features/workspace';

import { ONBOARDING_VERSION, useOnboardingStore } from './store';

/**
 * 首启只做一件事：弹出「新建作品」。
 *
 * 作品是存储范围、写边界与文件可见性的落点，先把它建出来，后面每一步都有明确去处；
 * 主题、自动保存、模型都不在这里收集——它们只用默认值也能开工，留给设置页随时改。
 *
 * 同时承担启动期的设置加载：设置要过一次 IPC 才拿得到，首帧靠 index.html 上的
 * 静态主题类兜底，这里把真实设置取回来并落到 store。
 */
export function useFirstRunGuide(): void {
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();
  const onboarding = useOnboardingStore();

  onMounted(() => {
    if (!settings.state && !settings.isLoading) void settings.load();
  });

  watch(
    () => settings.state,
    state => {
      if (!state) return;
      if (!onboarding.consider(state.settings.onboarding?.completedVersion)) return;
      // 先弹窗、后落标记：设置写失败时用户仍能建作品，代价只是下次启动再提示一次。
      workspace.newWorkspaceOpen = true;
      void settings.update({ onboarding: { completedVersion: ONBOARDING_VERSION } });
    },
    { immediate: true }
  );
}
