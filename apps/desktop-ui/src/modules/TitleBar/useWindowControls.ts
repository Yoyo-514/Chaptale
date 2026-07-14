import { onMounted, ref } from 'vue';

import { getDesktopApi, hasDesktopApi } from '@/stores/utils/desktop-api';

/** 自定义标题栏的窗口控制；非桌面环境（浏览器 e2e/dev）下各操作为空操作。 */
export function useWindowControls() {
  const isDesktop = hasDesktopApi();
  const isMaximized = ref(false);

  async function refreshWindowState() {
    if (!isDesktop) {
      return;
    }

    const state = await getDesktopApi()
      .windowControl.isMaximized()
      .catch(() => undefined);
    isMaximized.value = state?.isMaximized ?? false;
  }

  async function minimize() {
    if (isDesktop) {
      await getDesktopApi().windowControl.minimize();
    }
  }

  async function toggleMaximize() {
    if (!isDesktop) {
      return;
    }

    const state = await getDesktopApi().windowControl.toggleMaximize();
    isMaximized.value = state?.isMaximized ?? false;
  }

  async function close() {
    if (isDesktop) {
      await getDesktopApi().windowControl.close();
    }
  }

  onMounted(() => {
    void refreshWindowState();
  });

  return { isDesktop, isMaximized, minimize, toggleMaximize, close };
}
