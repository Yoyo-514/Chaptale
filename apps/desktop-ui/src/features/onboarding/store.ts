import { defineStore } from 'pinia';

/**
 * 首启提示的版本号。
 *
 * 提升它会让所有既有用户在下次启动时重新看到「新建作品」提示——
 * 只在首次体验本身变化时才动它，不要用它来提醒功能更新。
 */
export const ONBOARDING_VERSION = 1;

/**
 * 首启判定。
 *
 * 这里只回答"要不要提示"，不发设置、不弹窗——副作用集中在 useFirstRunGuide，
 * 判定保持纯函数式才能在测试里直接驱动。
 */
export const useOnboardingStore = defineStore('onboarding', () => {
  let checked = false;

  /** 完成版本落后于当前版本时返回 true；同一次运行内只判定一次，设置刷新不会重复触发。 */
  function consider(completedVersion: number | undefined): boolean {
    if (checked) return false;
    checked = true;
    return (completedVersion ?? 0) < ONBOARDING_VERSION;
  }

  return { consider };
});
