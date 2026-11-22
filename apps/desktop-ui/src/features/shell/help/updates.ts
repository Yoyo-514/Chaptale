import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

import type { AppUpdate } from '@chaptale/desktop/bridge';

import { useNotificationStore } from '@/features/notifications';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const useAppUpdateStore = defineStore('app-updates', () => {
  const notifications = useNotificationStore();
  const available = shallowRef<AppUpdate | null>(null);
  const details = shallowRef<AppUpdate | null>(null);
  const checkingManually = ref(false);
  let startupState: Promise<boolean> | undefined;
  let request: Promise<void> | undefined;
  let progress: number | undefined;

  function showDetails(update: AppUpdate) {
    notifications.closePanel();
    details.value = update;
  }

  async function readStartupState() {
    try {
      const state = await getDesktopApi().help.getUpdateState();
      available.value = state.available;
      return state.checkOnStartup;
    } catch {
      // 启动检查不打断写作，手动检查仍可重试并看到失败原因。
      return false;
    }
  }

  async function check() {
    await startupState;
    try {
      const result = await getDesktopApi().help.checkUpdate();
      if (result.kind === 'available') {
        available.value = result.update;
        const title = `发现新版本 ${result.update.version}`;
        const description = '查看更新说明或前往 GitHub 下载。';
        const action = { label: '查看更新', run: () => showDetails(result.update) };
        if (progress !== undefined) notifications.finishProgress(progress, 'info', title, description, action);
        else if (result.announce) notifications.info(title, description, action);
      } else {
        available.value = null;
        if (progress !== undefined) {
          if (result.kind === 'current')
            notifications.finishProgress(progress, 'success', `已是最新版本 ${result.version}`, '');
          else notifications.finishProgress(progress, 'info', 'GitHub 暂无正式发布', '');
        }
      }
    } catch (error) {
      if (progress !== undefined)
        notifications.finishProgress(progress, 'error', '检查更新失败', toErrorMessage(error));
    }
  }

  function checkOnce() {
    // 手动检查可以接上尚未完成的启动检查，同一个请求只发一条结果通知。
    return (request ??= check().finally(() => {
      request = undefined;
      progress = undefined;
      checkingManually.value = false;
    }));
  }

  function start() {
    if (startupState) return;
    startupState = readStartupState();
    void startupState.then(enabled => {
      if (enabled) void checkOnce();
    });
  }

  function checkNow() {
    checkingManually.value = true;
    progress ??= notifications.startProgress('正在检查更新…', '正在向 GitHub 查询最新发布。');
    return checkOnce();
  }

  return { available, details, checkingManually, start, checkNow, showDetails };
});
