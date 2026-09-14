import { onBeforeUnmount, onMounted } from 'vue';

import type { WindowZoomCommand } from '@chaptale/ipc-contract';

import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

/** 菜单与键盘共用受验证的窗口命令，不触碰编辑器自己的字号或撤销历史。 */
async function zoom(command: WindowZoomCommand) {
  if (hasDesktopApi()) await getDesktopApi().windowControl.zoom(command);
}

export function useInterfaceZoom() {
  function onKeydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const command =
      event.key === '0' ? 'reset' : ['+', '='].includes(event.key) ? 'in' : event.key === '-' ? 'out' : null;
    if (!command) return;
    event.preventDefault();
    void zoom(command);
  }
  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
  return { zoom };
}
